import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { forEachFirmWithFeature } from '@/lib/tenancy/fan-out';
import { generateMatterBrief, type MatterContext } from '@/lib/ai/matter-brief';
import { generateEmbeddingsForMatterSummary } from '@/lib/ai/embeddings';

export const maxDuration = 300; // up to 5 min per tick

/**
 * GET /api/matter-summary/refresh-stale
 * POST /api/matter-summary/refresh-stale
 *
 * Drains matter_summaries.needs_refresh = TRUE. Processes up to `limit`
 * matters per invocation (default 10, capped at 25) — enough to keep pace
 * with normal traffic without blowing the Vercel function budget.
 *
 * GET: invoked by Vercel cron; limit comes from `?limit=` query.
 * POST: same auth, body `{ limit? }` for manual kicks.
 * Auth: CRON_SECRET via `Authorization: Bearer <secret>` header.
 *
 * Returns: { processed, errors, remaining, matters: [{ matterId, name, tokens }] }
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

  // Read limit from body (POST) or query (GET). Default 10, cap 25.
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

type RefreshResult = {
  processed: number;
  errors: number;
  remaining: number;
  matters: { matterId: string; name: string | null; input: number; output: number; ok: boolean; error?: string }[];
};

async function refreshStaleForFirm(supabase: SupabaseClient, firmId: string, limit: number): Promise<RefreshResult> {
  // Pick the oldest stale briefs first — if something has been flagged for a
  // while it's probably been read in the stale state already.
  const { data: stale, error: pickErr } = await supabase
    .from('matter_summaries')
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
    .select('notion_id, name, matter_code, type, status, case_title, case_number, case_description, court, client_name, is_case')
    .in('notion_id', ids);

  if (mErr) {
    throw new Error(mErr.message);
  }

  const matterMap = new Map((matters ?? []).map((m) => [m.notion_id, m]));

  let processed = 0;
  let errors = 0;
  const results: { matterId: string; name: string | null; input: number; output: number; ok: boolean; error?: string }[] = [];

  for (const s of stale) {
    const m = matterMap.get(s.matter_id);
    if (!m) {
      // Matter was deleted while its brief was flagged — clear the flag and skip.
      await supabase
        .from('matter_summaries')
        .update({ needs_refresh: false, refresh_requested_at: null })
        .eq('matter_id', s.matter_id);
      continue;
    }

    const ctx: MatterContext = {
      notion_id: m.notion_id,
      name: m.name,
      matter_code: m.matter_code,
      type: m.type,
      status: m.status,
      case_title: m.case_title,
      case_number: m.case_number,
      case_description: m.case_description,
      court: m.court,
      client_name: m.client_name,
      is_case: !!m.is_case,
      firmId,
    };

    try {
      const brief = await generateMatterBrief(ctx);

      await supabase.from('matter_summaries').upsert({
        matter_id: m.notion_id,
        summary: brief.summary,
        latest_incident: brief.latest_incident,
        latest_incident_date: brief.latest_incident_date,
        brief_version: brief.brief_version,
        key_dates: brief.key_dates,
        open_issues: brief.open_issues,
        posture: brief.posture,
        parties: brief.parties,
        claims_and_defenses: brief.claims_and_defenses,
        court_and_venue: brief.court_and_venue,
        key_rulings: brief.key_rulings,
        // null means juris.ph was unreachable (or a non-case) — omit the column
        // so an outage never clobbers previously stored authorities.
        ...(brief.relevant_authorities !== null
          ? { relevant_authorities: brief.relevant_authorities }
          : {}),
        model_used: brief.model,
        token_count_input: brief.input_tokens,
        token_count_output: brief.output_tokens,
        needs_refresh: false,
        refresh_requested_at: null,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'matter_id' });

      // Refresh embeddings — fire-and-forget, same pattern as the backfill script.
      generateEmbeddingsForMatterSummary(m.notion_id, firmId).catch(() => { /* ignore */ });

      processed++;
      results.push({
        matterId: m.notion_id,
        name: m.name,
        input: brief.input_tokens,
        output: brief.output_tokens,
        ok: true,
      });
    } catch (err) {
      errors++;
      results.push({
        matterId: m.notion_id,
        name: m.name,
        input: 0,
        output: 0,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      // Leave the flag as-is so the next tick retries.
    }
  }

  // Remaining count for observability.
  const { count: remaining } = await supabase
    .from('matter_summaries')
    .select('*', { count: 'exact', head: true })
    .eq('needs_refresh', true);

  return {
    processed,
    errors,
    remaining: remaining ?? 0,
    matters: results,
  };
}
