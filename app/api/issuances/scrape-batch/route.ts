import { NextResponse } from 'next/server';
import { issuanceBatchSchema } from '@/lib/issuances/schema';
import { ingestItems } from '@/lib/issuances/ingest';
import type { SourceKey } from '@/lib/issuances/sources';
import { forEachFirmWithFeature } from '@/lib/tenancy/fan-out';

export const maxDuration = 300;

/**
 * POST /api/issuances/scrape-batch
 *
 * External ingestion endpoint: scheduled remote Claude agents (routines) and
 * manual tooling POST scraped items here. The in-repo scrape cron
 * (/api/cron/issuances-scrape) calls ingestItems directly and does not hit
 * this route. Both share the same write path (lib/issuances/ingest).
 *
 * Body shape:
 * {
 *   source: 'bir',
 *   run_started_at: '2026-05-26T22:00:00Z',
 *   items: [{ type, number, title, ..., source_url, ai_confidence, ... }, ...]
 * }
 *
 * Issuances are PH-jurisdiction-global content on tenant-keyed tables: one
 * scraped batch is ingested once per active firm, each firm getting its own
 * run row. Returns { items_found, items_new, firms: [{ slug, ok, run_id,
 * items_found, items_new, items_low_conf, errors, error? }] }.
 *
 * Per CLAUDE.md "Crons must stay service-role" rule: this handler does not
 * accept a session JWT and writes via service role. The UNIQUE
 * (source, type, number) constraint dedups silently on conflict.
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = issuanceBatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const source = parsed.data.source as SourceKey;

  try {
    // Same fan-out as /api/cron/issuances-scrape: the batch was scraped once
    // (globally) and is ingested into every active firm's tenant-keyed rows.
    const firmRuns = await forEachFirmWithFeature('issuances', ({ firm }) =>
      ingestItems(firm.id, source, parsed.data.items, parsed.data.run_started_at),
    );
    return NextResponse.json({
      items_found: parsed.data.items.length,
      items_new: firmRuns.reduce((n, r) => n + (r.result?.items_new ?? 0), 0),
      firms: firmRuns.map(({ slug, ok, result, error, skipped }) => ({
        slug,
        ok,
        ...result,
        error,
        skipped,
      })),
    });
  } catch (err) {
    console.error('[scrape-batch]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to open run row' }, { status: 500 });
  }
}
