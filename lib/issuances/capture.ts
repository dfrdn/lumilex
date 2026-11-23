import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { firecrawlScrape } from '@/lib/issuances/firecrawl';
import { downloadAndStorePdf } from '@/lib/issuances/pdf-snapshot';

/**
 * Durability capture for a newly-ingested issuance. Best-effort: called from
 * ingest via `after()` so it runs after the response but still completes on
 * Vercel. Failures are logged, never thrown — the row is always usable with
 * just its source_url.
 *
 * Strategy (PH gov sites vary wildly):
 *  1. Direct PDF link (BIR, NPC): download the binary → public bucket → pdf_path.
 *  2. HTML detail page (SEC): the binary usually sits behind a WAF, so instead
 *     Firecrawl-scrape the page for durable full text, and opportunistically
 *     try to snapshot any PDF link found on it.
 *  3. WAF-blocked PDF (DOJ): the direct download 403s and Firecrawl's PDF parse
 *     is too slow to be worth it — we keep the working source_url and move on.
 *
 * We never Firecrawl-parse a PDF URL (it can hang for 90s+); Firecrawl is only
 * pointed at HTML pages.
 */
export interface CaptureInput {
  source_url: string;
  pdf_url?: string | null;
  full_text?: string | null;
}

export async function captureDocument(
  firmId: string,
  item: CaptureInput,
  issuanceId: number,
): Promise<void> {
  const directPdf = item.pdf_url ?? (looksLikePdf(item.source_url) ? item.source_url : null);

  // 1. Binary snapshot when we have a direct PDF link (BIR, NPC).
  if (directPdf) {
    try {
      await downloadAndStorePdf(firmId, directPdf, issuanceId);
      return;
    } catch (err) {
      // WAF/403, or a "pdf_url" that actually serves HTML (e.g. IPO's
      // SharePoint viewer links). Fall through to the full-text path below.
      console.warn(
        `[issuances/capture] binary snapshot failed for ${issuanceId} (${directPdf}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 2. Full-text fallback via Firecrawl — HTML pages only. We never point
  //    Firecrawl at a real PDF URL: parsing a (often WAF-blocked) PDF can hang
  //    for 90s+. So if the source_url is itself a PDF (e.g. DOJ), there's no
  //    fast durable copy to be had — keep the source link and stop.
  if (item.full_text || looksLikePdf(item.source_url)) return;
  try {
    const { markdown } = await firecrawlScrape(item.source_url);
    const pdfLink = firstPdfLink(markdown);

    if (pdfLink) {
      try {
        await downloadAndStorePdf(firmId, pdfLink, issuanceId);
      } catch {
        /* PDF likely WAF-blocked; full text below still gives durability */
      }
    }

    await getServiceDbForFirm(firmId)
      .from('issuances')
      .update({ full_text: markdown, updated_at: new Date().toISOString() })
      .eq('id', issuanceId);
  } catch (err) {
    console.warn(
      `[issuances/capture] full-text capture failed for ${issuanceId} (${item.source_url}):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** True when a URL's path ends in `.pdf` (ignoring any query/fragment). */
export function looksLikePdf(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

/** First absolute `.pdf` URL referenced in a markdown blob, cleaned of any
 * trailing link text Firecrawl sometimes appends inside the parentheses. */
function firstPdfLink(markdown: string): string | null {
  const m = markdown.match(/https?:\/\/[^\s)"']+?\.pdf/i);
  return m ? m[0] : null;
}
