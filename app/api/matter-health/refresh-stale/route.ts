import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { forEachFirmWithFeature } from '@/lib/tenancy/fan-out';
import { generateMatterHealth, type MatterHealthContext } from '@/lib/ai/matter-health';
import { MATTER_STATUS } from '@/lib/matter-status';
import { manilaDayStart, manilaToday } from '@/lib/dates';

export const maxDuration = 300; // up to 5 min per tick

/**
 * GET/POST /api/matter-health/refresh-stale
 *
 * Drains matter_health.needs_refresh = TRUE. Mirrors matter-summary's
 * refresh-stale shape. CRON_SECRET-gated (Bearer header). Service-role
 * client throughout.
 *
 * Cron-scheduled in vercel.json — runs nightly after matter-summary so the
 * two artifacts don't compete for the same Anthropic minute.
 */

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let limitRaw: number | null = null;
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    limitRaw = Number(body.limit) || null;
  } else {
    const url = new URL(req.url);
    limitRaw = Number(url.searchParams.get('limit')) || null;
  }
  const limit = Math.max(1, Math.min(25, limitRaw ?? 10));

  // Per-firm fan-out; `limit` applies per firm.
  const firms = await forEachFirmWithFeature('ai_analysis', ({ firm, db }) => refreshStaleForFirm(db, firm.id, limit));

  return NextResponse.json({
    processed: firms.reduce((n, f) => n + (f.result?.processed ?? 0), 0),
    errors: firms.reduce((n, f) => n + (f.result?.errors ?? 0), 0),
    remaining: firms.reduce((n, f) => n + (f.result?.remaining ?? 0), 0),
    matters: firms.flatMap((f) => f.result?.matters ?? []),
    firms: firms.map(({ firmId, slug, ok, error }) => ({ firmId, slug, ok, error })),
  });
}

type HealthRefreshResult = {
  processed: number;
  errors: number;
  remaining: number;
  matters: { matterId: string; name: string | null; score?: number; tier?: string; ok: boolean; error?: string }[];
};

async function refreshStaleForFirm(supabase: SupabaseClient, firmId: string, limit: number): Promise<HealthRefreshResult> {
  // Health only tracks LIVE matters — re-scoring Done/Archived/Cancelled matters
  // is wasted LLM spend and bloats the daily backlog (the cause of the slow
  // refresh cycle). Resolve the live set once and use it for both the sweep
  // and the per-row guard below.
  const TERMINAL_MATTER_STATUSES: readonly string[] = [MATTER_STATUS.DONE, MATTER_STATUS.ARCHIVED];
  const { data: liveMatters } = await supabase
    .from('matters')
    .select('notion_id')
    .not('status', 'in', `(${TERMINAL_MATTER_STATUSES.join(',')})`);
  const liveIds = new Set((liveMatters ?? []).map((m) => m.notion_id));

  // Daily sweep: signals like "deliverable just crossed its due date" change
  // without a trigger firing. Flag live matters not refreshed today so the cron
  // recomputes regardless of trigger activity. Scoped to live matters so the
  // sweep stays proportional to the active caseload.
  const today = manilaToday();
  if (liveIds.size > 0) {
    await supabase
      .from('matter_health')
      .update({ needs_refresh: true, refresh_requested_at: new Date().toISOString() })
      .lt('generated_at', manilaDayStart(today))
      .eq('needs_refresh', false)
      .in('matter_id', [...liveIds]);
  }

  // Oldest stale first.
  const { data: stale, error: pickErr } = await supabase
    .from('matter_health')
    .select('matter_id, refresh_requested_at')
    .eq('needs_refresh', true)
    .order('refresh_requested_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (pickErr) {
    throw new Error(pickErr.message);
  }
  if (!stale || stale.length === 0) {
    return { processed: 0, errors: 0, remaining: 0, matters: [] };
  }

  const ids = stale.map((s) => s.matter_id);
  const { data: matters, error: mErr } = await supabase
    .from('matters')
    .select('notion_id, name, matter_code, type, status, client_name, created_time')
    .in('notion_id', ids);

  if (mErr) {
    throw new Error(mErr.message);
  }

  const matterMap = new Map((matters ?? []).map((m) => [m.notion_id, m]));

  let processed = 0;
  let errors = 0;
  const results: { matterId: string; name: string | null; score?: number; tier?: string; ok: boolean; error?: string }[] = [];

  for (const s of stale) {
    const m = matterMap.get(s.matter_id);
    // Clear the flag without an LLM call when the matter is gone OR terminal —
    // terminal matters' health is static, so spending a narrative on them is waste.
    if (!m || !liveIds.has(s.matter_id)) {
      await supabase
        .from('matter_health')
        .update({ needs_refresh: false, refresh_requested_at: null })
        .eq('matter_id', s.matter_id);
      continue;
    }

    const ctx: MatterHealthContext = {
      notion_id: m.notion_id,
      name: m.name,
      matter_code: m.matter_code,
      type: m.type,
      status: m.status,
      client_name: m.client_name,
      created_time: m.created_time,
      firmId,
    };

    try {
      const health = await generateMatterHealth(ctx);

      await supabase.from('matter_health').upsert({
        matter_id: m.notion_id,
        score: health.score,
        tier: health.tier,
        signals: health.signals,
        narrative: health.narrative,
        model_used: health.model,
        token_count_input: health.inputTokens,
        token_count_output: health.outputTokens,
        generated_at: new Date().toISOString(),
        needs_refresh: false,
        refresh_requested_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'matter_id' });

      processed++;
      results.push({ matterId: m.notion_id, name: m.name, score: health.score, tier: health.tier, ok: true });
    } catch (err) {
      errors++;
      results.push({
        matterId: m.notion_id,
        name: m.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const { count: remaining } = await supabase
    .from('matter_health')
    .select('*', { count: 'exact', head: true })
    .eq('needs_refresh', true);

  return {
    processed,
    errors,
    remaining: remaining ?? 0,
    matters: results,
  };
}
