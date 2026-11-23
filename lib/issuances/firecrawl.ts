// Thin REST wrapper over the Firecrawl v2 scrape endpoint. We call the API
// directly rather than pull in the SDK — the surface we need is one POST, and
// CLAUDE.md keeps the dependency list tight.
//
// Used by the issuances scrape cron to turn a government-site index page into
// clean markdown before Claude structures it (lib/issuances/extract.ts).

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v2';

export interface ScrapeResult {
  /** Clean markdown of the page body. */
  markdown: string;
  /** The URL Firecrawl actually landed on after redirects, if reported. */
  sourceUrl: string;
}

/** True when the platform holds a Firecrawl key. Firecrawl is a platform
 *  service (per-request compute, not a per-firm identity), so this is a
 *  platform-level prerequisite for the `issuances` feature. */
export function isFirecrawlConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}

/**
 * Scrape a single URL to clean markdown.
 *
 * Throws if FIRECRAWL_API_KEY is unset, the request fails, or Firecrawl
 * returns no markdown — the caller isolates this per-source so one dead site
 * doesn't sink the whole run.
 */
export async function firecrawlScrape(url: string): Promise<ScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set');

  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      // Gov sites are slow and sometimes render listings client-side; give the
      // page a moment before capture.
      waitFor: 2000,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Firecrawl scrape failed for ${url}: ${res.status} ${res.statusText}${
        body ? ` — ${body.slice(0, 300)}` : ''
      }`,
    );
  }

  const json = (await res.json()) as {
    success?: boolean;
    error?: string;
    data?: { markdown?: string; metadata?: { sourceURL?: string; url?: string } };
  };

  if (json.success === false) {
    throw new Error(`Firecrawl scrape returned failure for ${url}: ${json.error ?? 'unknown error'}`);
  }

  const markdown = json.data?.markdown?.trim();
  if (!markdown) {
    throw new Error(`Firecrawl scrape returned no markdown for ${url}`);
  }

  return {
    markdown,
    sourceUrl: json.data?.metadata?.sourceURL ?? json.data?.metadata?.url ?? url,
  };
}
