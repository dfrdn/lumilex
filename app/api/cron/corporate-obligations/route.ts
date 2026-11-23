import { NextResponse } from 'next/server';
import { forEachActiveFirm } from '@/lib/tenancy/fan-out';
import { rollForwardObligations } from '@/lib/corporations/roll-forward';

export const maxDuration = 60;

/**
 * GET /api/cron/corporate-obligations[?dryRun=1]
 *
 * Nightly, per firm: raises the next GIS, AFS and annual ITR, and the
 * business-permit renewal task, for every registered company whose
 * `firm_files` switch says the firm files it, when the period still to fall
 * due isn't on the board yet (lib/corporations/roll-forward.ts). `dryRun=1`
 * reports what it would raise and writes nothing.
 *
 * Auth: CRON_SECRET via `Authorization: Bearer <secret>`. Service-role
 * throughout — there is no JWT on this path.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1';
  const results = await forEachActiveFirm(({ firm, db }) => rollForwardObligations(db, firm.id, { dryRun }));
  return NextResponse.json({ dryRun, results });
}
