import { NextResponse } from 'next/server';
import {
  SOURCES,
  SOURCE_KEYS,
  isValidSource,
  type SourceKey,
} from '@/lib/issuances/sources';
import { firecrawlScrape } from '@/lib/issuances/firecrawl';
import { extractIssuances } from '@/lib/issuances/extract';
import { ingestItems } from '@/lib/issuances/ingest';
import { forEachFirmWithFeature } from '@/lib/tenancy/fan-out';

export const maxDuration = 300;

/**
 * GET|POST /api/cron/issuances-scrape[?source=bir]
 *
 * In-repo scrape pipeline for PH legal issuances. For each source: Firecrawl
 * scrapes the index page to clean markdown, Claude structures it into items,
 * and lib/issuances/ingest writes them (opening a run row per source).
 *
 * Auth: CRON_SECRET via `Authorization: Bearer <secret>`. Service-role
 * throughout (the issuances tables are deny-by-default under RLS).
 *
 * Sources are processed sequentially and isolated per-source: one dead site
 * or a Firecrawl/Claude failure records a failed run for that source and the
 * loop continues. Pass ?source= to scope a single source (useful for retries
 * or splitting the run if the full sweep approaches the 300s ceiling).
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

  const url = new URL(req.url);
  const sourceParam = url.searchParams.get('source');
  let sources: SourceKey[];
  if (sourceParam) {
    if (!isValidSource(sourceParam)) {
      return NextResponse.json({ error: `Unknown source "${sourceParam}"` }, { status: 400 });
    }
    sources = [sourceParam];
  } else {
    sources = SOURCE_KEYS.filter((k) => !SOURCES[k].scrapingDisabled);
  }

  // Issuances are PH-jurisdiction-global content in tenant-keyed tables, so
  // each source is scraped and extracted ONCE (external calls stay flat), and
  // the resulting batch is ingested into every active firm. The cost is
  // per-firm row/snapshot duplication — see lib/issuances/ingest.ts.
  const runStartedAt = new Date().toISOString();
  const results: Array<Record<string, unknown>> = [];
  let totalNew = 0;

  for (const source of sources) {
    try {
      const { markdown } = await firecrawlScrape(SOURCES[source].url);
      const { items, dropped, output_tokens } = await extractIssuances(source, markdown);

      if (items.length === 0) {
        results.push({ source, items_found: 0, items_new: 0, dropped, note: 'no items extracted' });
        continue;
      }

      const firmRuns = await forEachFirmWithFeature('issuances', ({ firm }) =>
        ingestItems(firm.id, source, items, runStartedAt),
      );
      const sourceNew = firmRuns.reduce((n, r) => n + (r.result?.items_new ?? 0), 0);
      totalNew += sourceNew;
      results.push({
        source,
        items_found: items.length,
        items_new: sourceNew,
        dropped,
        output_tokens,
        firms: firmRuns.map(({ slug, ok, result, error, skipped }) => ({
          slug,
          ok,
          ...result,
          error,
          skipped,
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[issuances-scrape] source "${source}" failed:`, message);
      results.push({ source, error: message });
    }
  }

  return NextResponse.json({
    sources: sources.length,
    items_new: totalNew,
    results,
  });
}
