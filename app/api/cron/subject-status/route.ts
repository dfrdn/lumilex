import { NextResponse } from 'next/server';
import { forEachActiveFirm } from '@/lib/tenancy/fan-out';
import { refreshSubjectStatus } from '@/lib/corporations/status-refresh';

export const maxDuration = 60;
const BUDGET_MS = 45_000;

/**
 * GET /api/cron/subject-status
 *
 * Every five minutes, per firm: recompute the stored status of companies and
 * marks whose record changed (marked stale by trigger) or whose reading is
 * from an earlier day, in batches, until done or the shared budget runs out —
 * the rest go next run (lib/corporations/status-refresh.ts).
 *
 * Auth: CRON_SECRET via `Authorization: Bearer <secret>`. Service-role
 * throughout — there is no JWT on this path.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const deadline = Date.now() + BUDGET_MS;
  const results = await forEachActiveFirm(({ firm, db }) => refreshSubjectStatus(db, firm.id, { deadline }));
  return NextResponse.json({ results });
}
