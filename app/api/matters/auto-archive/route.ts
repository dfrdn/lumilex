import { NextResponse } from 'next/server';
import { forEachActiveFirm } from '@/lib/tenancy/fan-out';
import { logAudit } from '@/lib/audit';
import { IDLE_ARCHIVE_DAYS } from '@/lib/matters/archive';
import { MATTER_STATUS } from '@/lib/matter-status';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Parse an optional non-negative integer param. Returns fallback when absent or
// invalid, but preserves an explicit 0 (e.g. limit=0 means "archive nothing").
function parseNonNegInt(raw: unknown, fallback: number | null): number | null {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * GET  /api/matters/auto-archive
 * POST /api/matters/auto-archive
 *
 * Archives Ongoing matters that have gone cold — no work (file, chat, email,
 * billing/expense/action entry, DTR) for `days` days. Reactivation is handled
 * in the DB: a write to any work table flips an Archived matter back to Ongoing
 * (see migration 20260602_matter_activity_tracking.sql), so this only needs to
 * push stale matters into Archived.
 *
 * Done matters are deliberately left alone — Done is a manual terminal state.
 * The client-status rollup trigger recalculates clients.status automatically.
 *
 * Query/body params:
 *   - days:    idle threshold (default 60)
 *   - limit:   cap matters touched this run (optional)
 *   - dryRun:  'true' → report eligible matters without archiving
 *
 * Auth: CRON_SECRET via `Authorization: Bearer <secret>` (Vercel cron header).
 * Returns: { archived, dryRun, days, matters: [{ notionId, name, lastActivityAt }] }
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

  let days = IDLE_ARCHIVE_DAYS;
  let limit: number | null = null;
  let dryRun = false;

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    days = Number(body.days) || IDLE_ARCHIVE_DAYS;
    limit = parseNonNegInt(body.limit, null);
    dryRun = body.dryRun === true || body.dryRun === 'true';
  } else {
    const url = new URL(req.url);
    days = Number(url.searchParams.get('days')) || IDLE_ARCHIVE_DAYS;
    limit = parseNonNegInt(url.searchParams.get('limit'), null);
    dryRun = url.searchParams.get('dryRun') === 'true';
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const firms = await forEachActiveFirm(async ({ firm, db }) => {
    let query = db
      .from('matters')
      .select('notion_id, name, last_activity_at')
      .eq('status', 'Ongoing')
      .lt('last_activity_at', cutoff)
      .order('last_activity_at', { ascending: true });

    if (limit !== null) query = query.limit(limit);

    const { data: stale, error } = await query;
    if (error) throw new Error(error.message);

    const matters = (stale ?? []).map((m) => ({
      notionId: m.notion_id as string,
      name: (m.name as string) ?? '',
      lastActivityAt: m.last_activity_at as string,
    }));

    if (dryRun || matters.length === 0) {
      return { archived: 0, count: matters.length, matters };
    }

    const ids = matters.map((m) => m.notionId);
    const { error: updErr } = await db
      .from('matters')
      .update({ status: MATTER_STATUS.ARCHIVED })
      .in('notion_id', ids);

    if (updErr) throw new Error(updErr.message);

    for (const m of matters) {
      logAudit({
        firmId: firm.id,
        entityType: 'Matter',
        entityId: m.notionId,
        entityName: m.name,
        action: 'archived',
        fieldChanged: 'status',
        oldValue: 'Ongoing',
        newValue: MATTER_STATUS.ARCHIVED,
        performedBy: 'system',
        performedByName: 'Auto-archive',
      });
    }

    return { archived: matters.length, count: matters.length, matters };
  });

  return NextResponse.json({
    archived: firms.reduce((n, f) => n + (f.result?.archived ?? 0), 0),
    dryRun,
    days,
    count: firms.reduce((n, f) => n + (f.result?.count ?? 0), 0),
    matters: firms.flatMap((f) => f.result?.matters ?? []),
    firms: firms.map(({ firmId, slug, ok, error }) => ({ firmId, slug, ok, error })),
  });
}
