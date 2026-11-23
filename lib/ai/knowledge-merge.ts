/**
 * Pure helpers for combining keyword ("exact") hits with semantic hits.
 * Kept free of Supabase so they can be unit-tested.
 */

/** Longer inputs are briefs pasted by machines, not phrases a person typed. */
export const KEYWORD_QUERY_MAX_CHARS = 120;

export function isKeywordEligible(query: string): boolean {
  const t = query.trim();
  return t.length >= 2 && t.length <= KEYWORD_QUERY_MAX_CHARS;
}

/** Markers the search_document_text RPC wraps around matched terms. */
export const HEADLINE_START = '«';
export const HEADLINE_STOP = '»';

export function stripHeadlineMarkers(headline: string): string {
  return headline.split(HEADLINE_START).join('').split(HEADLINE_STOP).join('').replace(/\s+/g, ' ').trim();
}

/**
 * Exact hits lead; a semantic hit for the same source is dropped so a
 * document never appears twice. Order within each list is preserved.
 */
export function mergeExactFirst<T extends { key: string }>(exact: T[], semantic: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of exact) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(e);
  }
  for (const s of semantic) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    out.push(s);
  }
  return out;
}
