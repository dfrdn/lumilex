// Client for juris.ph — free public semantic index of PH Supreme Court decisions
// and Republic Acts (sourced from lawphil, AI-summarized). The endpoint is the
// site's MCP server: stateless JSON-RPC over POST, no auth, no SLA. Every caller
// must treat it as best-effort — search returns null when the service is
// unreachable, and nothing in the app may block on it.
//
// Summaries/holdings are AI-generated; anything destined for a filing must be
// verified against the linked full text / PDF.

const JURIS_MCP_URL = 'https://juris.ph/mcp';
const DEFAULT_TIMEOUT_MS = 12_000;

export interface JurisCaseHit {
  id: string;
  score?: number;
  case_number: string;
  case_title: string;
  case_type?: string;
  division?: string;
  ponente?: string;
  year?: number;
  decision_date?: string;
  facts?: string;
  disposition?: string;
  tags?: string[];
  legal_rules_cited?: string[];
  url: string;
  pdf_url?: string;
}

export interface JurisRaHit {
  id: string;
  score?: number;
  ra_number: string;
  title: string;
  year?: number;
  summary?: string;
  tags?: string[];
  url: string;
  pdf_url?: string;
}

export interface JurisCaseRecord {
  id: string;
  year?: number;
  case_number: string;
  case_title: string;
  case_type?: string;
  division?: string;
  ponente?: string;
  is_en_banc?: boolean;
  decision_date_iso?: string;
  factual_background?: string;
  procedural_history?: string;
  court_reasoning?: string;
  final_disposition?: string;
  legal_issues?: string[];
  tags?: string[];
  keywords?: string[];
  cited_gr_numbers?: string[];
  cited_ra_numbers?: string[];
  url?: string;
  full_text?: string;
  [key: string]: unknown;
}

export interface JurisRaRecord {
  id: string;
  year?: number;
  title: string;
  summary?: string;
  key_provisions?: unknown[];
  tags?: string[];
  url?: string;
  pdf_url?: string;
  full_text?: string;
  [key: string]: unknown;
}

export type JurisLookup<T> =
  | { status: 'found'; record: T }
  | { status: 'not_found' }
  | { status: 'unavailable' };

async function callJurisTool(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: true; text: string } | { ok: false; isError: boolean; text: string }> {
  const res = await fetch(JURIS_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`juris.ph HTTP ${res.status}`);
  const body = await res.json();
  const text: string = body?.result?.content?.[0]?.text ?? '';
  if (body?.error || body?.result?.isError) {
    return { ok: false, isError: true, text: text || body?.error?.message || 'juris.ph tool error' };
  }
  return { ok: true, text };
}

/** Semantic search over SC decisions. Returns null when juris.ph is unreachable. */
export async function searchJurisprudence(
  query: string,
  opts: { limit?: number; year?: number; caseType?: string; timeoutMs?: number } = {},
): Promise<JurisCaseHit[] | null> {
  try {
    const r = await callJurisTool(
      'search_jurisprudence',
      {
        query,
        limit: opts.limit ?? 5,
        ...(opts.year ? { year: opts.year } : {}),
        ...(opts.caseType ? { case_type: opts.caseType } : {}),
      },
      opts.timeoutMs,
    );
    if (!r.ok) return null;
    return (JSON.parse(r.text).results ?? []) as JurisCaseHit[];
  } catch {
    return null;
  }
}

/**
 * juris.ph omits `score` on exact/keyword-title matches — verified live, those
 * are its STRONGEST hits, not its weakest. Normalize (scoreless → 1), filter,
 * sort, and cap in one place so every consumer agrees on what counts as an
 * authority. Returns hits with `score` guaranteed set.
 */
export function topJurisprudenceHits(
  hits: JurisCaseHit[],
  opts: { minScore?: number; limit?: number } = {},
): (JurisCaseHit & { score: number })[] {
  return hits
    .map((h) => ({ ...h, score: h.score ?? 1 }))
    .filter((h) => h.score >= (opts.minScore ?? 0.5))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 5);
}

/** Semantic search over Republic Acts. Returns null when juris.ph is unreachable. */
export async function searchRepublicActs(
  query: string,
  opts: { limit?: number; year?: number } = {},
): Promise<JurisRaHit[] | null> {
  try {
    const r = await callJurisTool('search_republic_acts', {
      query,
      limit: opts.limit ?? 5,
      ...(opts.year ? { year: opts.year } : {}),
    });
    if (!r.ok) return null;
    return (JSON.parse(r.text).results ?? []) as JurisRaHit[];
  } catch {
    return null;
  }
}

/** Fetch one decision by juris.ph id or official case number ("G.R. No. 254972"). */
export async function getJurisCase(ref: {
  id?: string;
  caseNumber?: string;
  includeFullText?: boolean;
}): Promise<JurisLookup<JurisCaseRecord>> {
  try {
    const r = await callJurisTool('get_case', {
      ...(ref.id ? { id: ref.id } : {}),
      ...(ref.caseNumber ? { case_number: ref.caseNumber } : {}),
      ...(ref.includeFullText ? { include_full_text: true } : {}),
    });
    if (!r.ok) {
      return /not found/i.test(r.text) ? { status: 'not_found' } : { status: 'unavailable' };
    }
    return { status: 'found', record: JSON.parse(r.text) as JurisCaseRecord };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Fetch one Republic Act by juris.ph id or RA number ("RA 11313" or "11313"). */
export async function getRepublicAct(ref: {
  id?: string;
  raNumber?: string;
  includeFullText?: boolean;
}): Promise<JurisLookup<JurisRaRecord>> {
  try {
    const r = await callJurisTool('get_republic_act', {
      ...(ref.id ? { id: ref.id } : {}),
      ...(ref.raNumber ? { ra_number: ref.raNumber } : {}),
      ...(ref.includeFullText ? { include_full_text: true } : {}),
    });
    if (!r.ok) {
      return /not found/i.test(r.text) ? { status: 'not_found' } : { status: 'unavailable' };
    }
    return { status: 'found', record: JSON.parse(r.text) as JurisRaRecord };
  } catch {
    return { status: 'unavailable' };
  }
}

// ---------------------------------------------------------------------------
// Citation extraction — pure text parsing, no network. Normalized forms match
// what juris.ph get_case / get_republic_act accept ("G.R. No. 188611", "RA 9165").
// ---------------------------------------------------------------------------

export interface ExtractedCitations {
  /** Normalized case numbers: "G.R. No. 188611", "A.M. No. P-03-1726", "A.C. No. 9269" */
  cases: string[];
  /** Normalized statute refs: "RA 11313" */
  ras: string[];
}

const MAX_CITATIONS_PER_KIND = 25;

// G.R. enumerations ("G.R. Nos. 111771, 111772 and 111773") are parsed by an
// explicit token walk instead of one big regex: pinpoint citations put a
// promulgation date and reporter volume right after the number ("G.R. No.
// 127685, 23 July 1998, 293 SCRA 141"), and lookahead-based rejection proved
// fragile twice — regex backtracking can shorten the matched number so the
// lookahead passes on the remainder, fabricating truncated phantom numbers.
const GR_HEAD_RE = /\bG\.?\s?R\.?\s+Nos?\.?\s*/gi;
// `(?!\d)` pins the complete digit run so validation always sees the whole number.
const GR_NUM_RE = /^((?:L-)?\d{1,6}(?:-\d{1,6})?)(?!\d)/;
const GR_SEP_RE = /^\s*(?:,|&|and\b)\s*/i;
const REPORTER_RE = /^\s*(?:SCRA|Phil\.?|O\.?\s?G\.?)\b/i;

const AM_AC_RE = /\bA\.?\s?([MC])\.?\s+Nos?\.?\s*((?:[A-Z]+-)*\d[\dA-Z.\-]*)/gi;
const RA_RE = /\b(?:R\.?\s?A\.?|Republic\s+Act)\s*[,.]?\s*(?:Nos?\.?)?\s*(\d{2,5})\b/gi;

function pushUnique(list: string[], value: string) {
  if (list.length < MAX_CITATIONS_PER_KIND && !list.includes(value)) list.push(value);
}

/** A 4-digit continuation number in an enumeration is almost always the
 *  promulgation year of a pinpoint cite, not a case number. */
function looksLikeYear(num: string): boolean {
  return /^\d{4}$/.test(num) && Number(num) >= 1900 && Number(num) <= 2099;
}

function extractGrNumbers(text: string, cases: string[]) {
  for (const head of text.matchAll(GR_HEAD_RE)) {
    let rest = text.slice((head.index ?? 0) + head[0].length);
    let first = true;
    for (;;) {
      const num = GR_NUM_RE.exec(rest);
      if (!num) break;
      const value = num[1];
      const after = rest.slice(num[0].length);
      if (!first) {
        // Continuations must look like case numbers: >=3 leading digits (a
        // day-of-month never has), not a bare year, not a reporter volume.
        const leadDigits = value.replace(/^L-/, '').split('-')[0];
        if (leadDigits.length < 3 || looksLikeYear(value) || REPORTER_RE.test(after)) break;
      }
      pushUnique(cases, `G.R. No. ${value.toUpperCase()}`);
      first = false;
      const sep = GR_SEP_RE.exec(after);
      if (!sep) break;
      rest = after.slice(sep[0].length);
    }
  }
}

export interface ResolvedCitation {
  /** Normalized citation, e.g. "G.R. No. 188611" or "RA 9165". */
  ref: string;
  kind: 'case' | 'ra';
  /** 'not_found' means juris.ph answered and has no such record — a signal the
   *  citation may be wrong. Lookups that failed transport are dropped, never
   *  recorded as not_found. */
  status: 'found' | 'not_found';
  title?: string;
  url?: string;
  date?: string;
}

/**
 * Extract citations from free text and verify each against juris.ph.
 * Best-effort: entries juris.ph couldn't be reached for are omitted, and an
 * outage yields [] rather than an error.
 */
export async function resolveCitations(
  text: string,
  opts: { maxCases?: number; maxRas?: number } = {},
): Promise<ResolvedCitation[]> {
  const { cases, ras } = extractCitations(text);
  const lookups: Promise<ResolvedCitation | null>[] = [
    ...cases.slice(0, opts.maxCases ?? 8).map(async (ref): Promise<ResolvedCitation | null> => {
      const res = await getJurisCase({ caseNumber: ref });
      if (res.status === 'unavailable') return null;
      if (res.status === 'not_found') return { ref, kind: 'case', status: 'not_found' };
      return {
        ref,
        kind: 'case',
        status: 'found',
        title: res.record.case_title?.slice(0, 200),
        url: res.record.url ? String(res.record.url) : `https://juris.ph/case/${res.record.id}`,
        date: res.record.decision_date_iso,
      };
    }),
    ...ras.slice(0, opts.maxRas ?? 6).map(async (ref): Promise<ResolvedCitation | null> => {
      const res = await getRepublicAct({ raNumber: ref });
      if (res.status === 'unavailable') return null;
      if (res.status === 'not_found') return { ref, kind: 'ra', status: 'not_found' };
      return {
        ref,
        kind: 'ra',
        status: 'found',
        title: res.record.title?.slice(0, 200),
        url: res.record.url ? String(res.record.url) : `https://juris.ph/republic-act/${res.record.id}`,
        date: res.record.year ? String(res.record.year) : undefined,
      };
    }),
  ];
  return (await Promise.all(lookups)).filter((c): c is ResolvedCitation => c !== null);
}

/** Extract PH case and statute citations from free text, deduped in order of appearance. */
export function extractCitations(text: string): ExtractedCitations {
  const cases: string[] = [];
  const ras: string[] = [];

  extractGrNumbers(text, cases);
  for (const m of text.matchAll(AM_AC_RE)) {
    const n = m[2].replace(/[.\-]+$/, '');
    pushUnique(cases, `A.${m[1].toUpperCase()}. No. ${n.toUpperCase()}`);
  }
  for (const m of text.matchAll(RA_RE)) {
    pushUnique(ras, `RA ${m[1]}`);
  }
  return { cases, ras };
}
