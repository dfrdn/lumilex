import type Anthropic from '@anthropic-ai/sdk';
import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { uploadToClaudeFiles } from '@/lib/ai/claude';
import { assembleDraftGrounding, type DraftGrounding } from '@/lib/ai/draft-grounding';
import { searchEmbeddingsByType } from '@/lib/ai/embeddings';
import {
  searchJurisprudence,
  topJurisprudenceHits,
  getJurisCase,
  getRepublicAct,
  extractCitations,
} from '@/lib/juris';
import { toolArray } from '@/lib/ai/json-response';
import { extractPdfText } from '@/lib/ai/pdf-text';

// Red Team — adversarial review of a pleading. Three passes:
//   1. recon (cheap): extract the pleading's propositions, citations, and
//      threshold requirements, plus a search query per proposition phrased to
//      find decisions that REFUTE it. When the draft answers another filing,
//      that filing is mapped in the same pass into a list of points a response
//      has to meet.
//   2. evidence: matter grounding + adverse juris.ph search + verification of
//      the authorities the pleading cites + reviewer notes from past runs.
//   3. analysis (expensive): argue against the pleading with all of the above
//      in hand, and rank what would actually be used against us.
//
// Every juris.ph leg is best-effort. The distinction that matters most: a
// citation juris.ph ANSWERED about and does not have is a real exposure; a
// citation we could not reach juris.ph about is nothing at all, and must never
// be reported as a problem.

const RECON_MODEL = 'claude-sonnet-5';
const ANALYSIS_MODEL = 'claude-opus-4-8';

const MAX_ADVERSE_QUERIES = 4;
const MAX_CITATION_CHECKS = 8;

// juris.ph is free, unauthenticated and explicitly no-SLA (see lib/juris.ts).
// Fanning out a whole run at once would put a dozen simultaneous requests on
// it; throttling then shows up as a partially-empty report rather than an
// error, which is the worst failure shape this feature has.
const JURIS_CONCURRENCY = 3;

/** Map with a bounded number of in-flight tasks, preserving input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export type RedTeamMode = 'self' | 'opposing';

export type FindingCategory =
  | 'procedural' | 'jurisdiction' | 'prescription' | 'evidentiary_gap'
  | 'authority_misuse' | 'contrary_authority' | 'missing_element'
  | 'internal_inconsistency' | 'record_contradiction' | 'admission_against_interest'
  | 'overclaim' | 'remedy_mismatch' | 'pleading_defect' | 'vagueness'
  | 'unanswered_allegation' | 'waived_defense' | 'unrebutted_argument';

const FINDING_CATEGORIES: FindingCategory[] = [
  'procedural', 'jurisdiction', 'prescription', 'evidentiary_gap',
  'authority_misuse', 'contrary_authority', 'missing_element',
  'internal_inconsistency', 'record_contradiction', 'admission_against_interest',
  'overclaim', 'remedy_mismatch', 'pleading_defect', 'vagueness',
];

// Only meaningful when the pleading being answered is in hand — without it the
// model has nothing to measure the response against, and a category it cannot
// ground invites exactly the speculative finding the prompt's second rule bans.
const RESPONSIVE_CATEGORIES: FindingCategory[] = [
  'unanswered_allegation', 'waived_defense', 'unrebutted_argument',
];

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Confidence = 'high' | 'medium' | 'low';

export interface RedTeamFinding {
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  heading: string;
  location: string;
  our_text: string;
  is_omission: boolean;
  attack: string;
  authority: string;
  fix: string;
  argument_line: string;
}

export interface AdverseAuthority {
  caseNumber: string;
  title: string;
  date?: string;
  snippet?: string;
  url: string;
  similarity: number;
  /** The proposition of ours this decision was surfaced against. */
  againstProposition: string;
}

/**
 * One authority the pleading cites, checked against juris.ph.
 * `not_found` means juris.ph answered and has no such record — a real exposure,
 * but NOT proof the citation is fabricated (the corpus is Supreme Court
 * decisions and Republic Acts only, and is not guaranteed complete). Citations
 * juris.ph could not be reached about are dropped entirely, never recorded here.
 */
export interface CitationCheck {
  ref: string;
  kind: 'case' | 'ra';
  offered_for: string;
  status: 'found' | 'not_found';
  verdict: 'supports' | 'mismatch' | 'unclear' | 'unverified';
  title?: string;
  url?: string;
  date?: string;
  note?: string;
}

interface CitationTarget {
  ref: string;
  kind: 'case' | 'ra';
  offered_for: string;
}

interface Proposition {
  proposition: string;
  why_it_matters: string;
  supporting_citations: string[];
  contrary_query: string;
}

interface PleadingSkeleton {
  document_type: string;
  relief_sought: string;
  propositions: Proposition[];
  cited_authorities: { citation: string; offered_for: string }[];
  threshold_items: { item: string; present: boolean; note: string }[];
}

/** One point in the pleading being answered that a response has to meet. */
export interface TargetPoint {
  ref: string;
  kind: 'allegation' | 'ground' | 'relief';
  text: string;
  requires_response: boolean;
}

export interface TargetSkeleton {
  document_type: string;
  relief_sought: string;
  points: TargetPoint[];
}

/** How the pleading under review dealt with one of the other side's points. */
export interface CoverageRow {
  ref: string;
  kind: TargetPoint['kind'];
  point: string;
  status: 'addressed' | 'partial' | 'missing' | 'unclear';
  note: string;
}

// The response has to meet every point; the checklist is only as useful as it is
// complete, so it is capped high enough for a long complaint and no higher.
const MAX_TARGET_POINTS = 30;

interface ReviewerNotes {
  /** Findings a lawyer marked wrong on a previous run of THIS pleading. */
  suppressed: { heading: string; body: string }[];
  /** Other notes on this pleading — authoritative context. */
  ownNotes: { heading: string; body: string }[];
  /** Semantically-related notes from OTHER pleadings — advisory only. */
  crossNotes: string[];
}


async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const is429 = err instanceof Error && (err.message.includes('429') || err.message.includes('rate_limit'));
      if (!is429 || attempt === maxRetries) throw err;
      const waitMs = Math.min(60_000, (2 ** attempt) * 15_000);
      console.log(`[red-team] Rate limited, retrying in ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error('Unreachable');
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────

/** Count findings by severity for the results header. */
export function rollUpSeverity(findings: RedTeamFinding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.severity in out) out[f.severity]++;
  }
  return out;
}

/**
 * The adverse-search queries to actually fire: the recon pass's contrary
 * queries, trimmed, deduped case-insensitively, and capped. A background job
 * runs each query once, so deduping here is the whole cache we need.
 */
export function adverseQueries(propositions: Proposition[], limit = MAX_ADVERSE_QUERIES): Proposition[] {
  const seen = new Set<string>();
  const out: Proposition[] = [];
  for (const p of propositions) {
    const q = (p.contrary_query ?? '').trim();
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...p, contrary_query: q });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Supreme Court ISSUANCES — the Rules of Court and every procedural rule —
 * carry A.M. numbers ending in "-SC" (A.M. No. 12-8-8-SC, the Judicial
 * Affidavit Rule; A.M. No. 19-08-15-SC, the 2019 Revised Rules on Evidence).
 * juris.ph indexes *decisions* and Republic Acts, so it will never hold one,
 * and cite-checking them produces a confident "could not be verified" against
 * the most-cited authorities in any pleading — pure noise, and exactly the kind
 * that makes a lawyer stop reading the report. Verified live against juris.ph.
 *
 * Disciplinary administrative matters and cases (A.M. No. P-03-1726, A.C. No.
 * 9269) ARE decisions and stay in.
 */
function isCourtIssuance(ref: string): boolean {
  return /^A\.M\. No\. .*-SC$/i.test(ref);
}

/**
 * Merge the citations the recon pass reported with a regex sweep of the
 * extracted text, so a citation the model glossed over still gets checked.
 * Every reference is normalized by running it back through extractCitations,
 * which is what juris.ph's lookups accept — a model writing "GR No. 188611"
 * and the regex writing "G.R. No. 188611" must collapse to one target.
 * Recon entries come first so their `offered_for` context survives the dedupe.
 */
export function reconcileCitations(
  reconCited: { citation: string; offered_for: string }[],
  extractedText: string,
  limit = MAX_CITATION_CHECKS,
): CitationTarget[] {
  const byRef = new Map<string, CitationTarget>();

  for (const entry of reconCited ?? []) {
    const { cases, ras } = extractCitations(entry.citation ?? '');
    const ref = cases[0] ?? ras[0];
    if (!ref) continue; // e.g. "Rule 65, Rules of Court" — not a juris.ph record
    if (isCourtIssuance(ref)) continue;
    if (!byRef.has(ref)) {
      byRef.set(ref, { ref, kind: cases[0] ? 'case' : 'ra', offered_for: (entry.offered_for ?? '').trim() });
    }
  }

  const swept = extractCitations(extractedText ?? '');
  for (const ref of swept.cases) {
    if (isCourtIssuance(ref)) continue;
    if (!byRef.has(ref)) byRef.set(ref, { ref, kind: 'case', offered_for: '' });
  }
  for (const ref of swept.ras) {
    if (!byRef.has(ref)) byRef.set(ref, { ref, kind: 'ra', offered_for: '' });
  }

  return [...byRef.values()].slice(0, limit);
}

export interface ModelCitationVerdict {
  ref: string;
  verdict: 'supports' | 'mismatch' | 'unclear';
  note: string;
}

/** Digits only — "G.R. 188611", "G.R. No. 188611" and "G.R. No. 188611 (2010)"
 *  all reduce to the same signature, which is what makes the fallback work. */
function digitSignature(ref: string): string {
  return ref.replace(/\D+/g, '');
}

/**
 * Match the model's cite-check verdicts back to the canonical references
 * reconcileCitations produced, resolving against the KNOWN target list rather
 * than trusting the model's formatting.
 *
 * The model routinely echoes a citation loosely ("G.R. 188611", "G.R. No.
 * 188611 (2010)"), and a raw-string join silently loses those verdicts — the
 * lawyer then sees every authority marked "unclear" and reads it as the model
 * failing to judge, when in fact it judged and the join dropped the answer.
 * Two passes: exact canonical match first, then an unambiguous digit-signature
 * match. An ambiguous signature is left unmatched on purpose — attaching the
 * wrong holding to a citation is worse than reporting "unclear". Entries with a
 * missing or non-string ref are skipped rather than allowed to throw, so one
 * malformed row cannot discard a completed analysis.
 */
export function matchVerdictsToTargets(
  targetRefs: string[],
  checks: ModelCitationVerdict[] | undefined,
): Map<string, ModelCitationVerdict> {
  const out = new Map<string, ModelCitationVerdict>();
  const valid = (checks ?? []).filter(
    (c): c is ModelCitationVerdict => !!c && typeof c.ref === 'string',
  );
  if (valid.length === 0) return out;

  const unclaimed = new Set(valid);

  // Pass 1 — the model echoed something that normalizes to a known ref.
  for (const target of targetRefs) {
    for (const c of unclaimed) {
      const { cases, ras } = extractCitations(c.ref);
      if ((cases[0] ?? ras[0] ?? c.ref.trim()) === target) {
        out.set(target, c);
        unclaimed.delete(c);
        break;
      }
    }
  }

  // Pass 2 — fall back to digits for formats the extractor can't parse.
  for (const target of targetRefs) {
    if (out.has(target)) continue;
    const sig = digitSignature(target);
    if (!sig) continue;
    const matches = [...unclaimed].filter((c) => digitSignature(c.ref) === sig);
    if (matches.length === 1) {
      out.set(target, matches[0]);
      unclaimed.delete(matches[0]);
    }
  }

  return out;
}

/**
 * Whether one juris.ph leg should be treated as having answered for this run.
 * `null` when nothing was asked of it — which is not the same as an outage, and
 * must not be rendered as one.
 *
 * Deliberately per-leg. Summing the adverse search and the cite-check into a
 * single flag lets a healthy cite-check mask a search that returned nothing,
 * and "no contrary authority found" then reads as clearance when it is really
 * "we never got to look".
 */
export function jurisAvailability(attempted: number, reachable: number): boolean | null {
  if (attempted === 0) return null;
  return reachable > 0;
}

export interface ModelCoverage {
  ref: string;
  status: 'addressed' | 'partial' | 'missing';
  note: string;
}

/**
 * "¶ 12", "Paragraph 12" and "par. 12" all reduce to "12"; "Ground II" to
 * "groundii". The prompt asks for the ref verbatim, but the model echoes loosely
 * often enough that a literal join would report answered points as unchecked.
 */
function coverageKey(ref: string): string {
  return (ref ?? '')
    .toLowerCase()
    .replace(/¶/g, ' ')
    .replace(/\b(paragraphs?|paras?|pars?|nos?|sections?|secs?)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Build the coverage table from the points the other side actually made, with
 * the model's verdict matched onto each.
 *
 * The rows are seeded from the target skeleton rather than from the model's
 * answer, because the failure that matters is an allegation nobody dealt with —
 * and a model that overlooks one simply does not emit a row for it. Seeding from
 * their pleading means an overlooked point still appears.
 *
 * A point the model said nothing about is 'unclear', never 'missing'. It is the
 * same distinction the juris.ph legs draw: not looked at is not the same as
 * looked at and absent, and reporting a silent row as a gap would send a lawyer
 * hunting for a hole that may not exist. Only points that actually require a
 * response are listed; formal recitals are not a coverage failure.
 */
export function mergeCoverage(
  points: TargetPoint[],
  reported: ModelCoverage[] | undefined,
): CoverageRow[] {
  const unclaimed = (reported ?? []).filter(
    (c): c is ModelCoverage => !!c && typeof c.ref === 'string',
  );

  return (points ?? [])
    .filter((p) => p && p.requires_response !== false && (p.text ?? '').trim())
    .map((p): CoverageRow => {
      const key = coverageKey(p.ref);
      const i = key ? unclaimed.findIndex((c) => coverageKey(c.ref) === key) : -1;
      const judged = i >= 0 ? unclaimed.splice(i, 1)[0] : null;
      return {
        ref: p.ref ?? '',
        kind: p.kind ?? 'allegation',
        point: p.text,
        status: judged?.status ?? 'unclear',
        note: judged?.note ?? (judged ? '' : 'The review did not report on this point — check it yourself.'),
      };
    });
}

// ── juris.ph legs ────────────────────────────────────────────────────

/** Search juris.ph for decisions that would REFUTE each proposition. */
async function findAdverseAuthorities(
  props: Proposition[],
): Promise<{ authorities: AdverseAuthority[]; attempted: number; reachable: number }> {
  const targets = adverseQueries(props);
  if (targets.length === 0) return { authorities: [], attempted: 0, reachable: 0 };

  const results = await mapLimit(targets, JURIS_CONCURRENCY, async (p) => ({
    p,
    hits: await searchJurisprudence(p.contrary_query, { limit: 5 }),
  }));

  const authorities: AdverseAuthority[] = [];
  const seen = new Set<string>();
  let reachable = 0;
  for (const { p, hits } of results) {
    if (hits === null) continue;
    reachable++;
    for (const h of topJurisprudenceHits(hits, { limit: 3 })) {
      if (seen.has(h.case_number)) continue;
      seen.add(h.case_number);
      authorities.push({
        caseNumber: h.case_number,
        title: (h.case_title ?? h.case_number).slice(0, 200),
        date: h.decision_date,
        snippet: (h.disposition || h.facts || '').slice(0, 400) || undefined,
        url: h.url,
        similarity: h.score,
        againstProposition: p.proposition.slice(0, 300),
      });
    }
  }
  return { authorities, attempted: targets.length, reachable };
}

interface VerifiedAuthority {
  target: CitationTarget;
  title: string;
  url?: string;
  date?: string;
  /** Compact holding block for the model to compare against `offered_for`. */
  holding: string;
}

/**
 * Look up every authority the pleading cites. Returns the ones juris.ph HAS
 * (with a compact holding for the model to check our use against) separately
 * from the ones it answered about and does not have.
 */
async function verifyCitedAuthorities(targets: CitationTarget[]): Promise<{
  verified: VerifiedAuthority[];
  missing: CitationTarget[];
  attempted: number;
  reachable: number;
}> {
  if (targets.length === 0) return { verified: [], missing: [], attempted: 0, reachable: 0 };

  const verified: VerifiedAuthority[] = [];
  const missing: CitationTarget[] = [];
  let reachable = 0;

  const lookups = await mapLimit(targets, JURIS_CONCURRENCY, async (target) => {
    if (target.kind === 'case') {
      return { target, res: await getJurisCase({ caseNumber: target.ref }) } as const;
    }
    return { target, res: await getRepublicAct({ raNumber: target.ref.replace(/^RA\s*/i, '') }) } as const;
  });

  for (const { target, res } of lookups) {
    if (res.status === 'unavailable') continue; // an outage is not a finding
    reachable++;
    if (res.status === 'not_found') {
      missing.push(target);
      continue;
    }
    if (target.kind === 'case') {
      const r = res.record as Record<string, unknown>;
      let holding = caseHolding(r);
      // The summary fields are AI-generated and occasionally empty. Only then
      // is the full text worth the extra round trip — asking for it up front
      // would let a few decisions dominate the analysis prompt.
      if (!holding) {
        const full = await getJurisCase({ caseNumber: target.ref, includeFullText: true });
        if (full.status === 'found') {
          holding = String((full.record as Record<string, unknown>).full_text ?? '').slice(0, 2000);
        }
      }
      verified.push({
        target,
        title: String(r.case_title ?? target.ref).slice(0, 200),
        url: r.url ? String(r.url) : `https://juris.ph/case/${String(r.id)}`,
        date: r.decision_date_iso ? String(r.decision_date_iso) : undefined,
        holding,
      });
    } else {
      const r = res.record as Record<string, unknown>;
      verified.push({
        target,
        title: String(r.title ?? target.ref).slice(0, 200),
        url: r.url ? String(r.url) : `https://juris.ph/republic-act/${String(r.id)}`,
        date: r.year ? String(r.year) : undefined,
        holding: String(r.summary ?? '').slice(0, 1500),
      });
    }
  }

  return { verified, missing, attempted: targets.length, reachable };
}

/**
 * Build the holding block from the record's already-summarized fields rather
 * than pulling full text — a handful of full decisions would dominate the
 * prompt. Returns '' when the summaries are empty, which is the caller's signal
 * to pay for a full-text lookup on that one decision.
 */
function caseHolding(r: Record<string, unknown>): string {
  const issues = Array.isArray(r.legal_issues) ? (r.legal_issues as unknown[]).map(String).join('; ') : '';
  return [
    issues ? `Issues: ${issues}` : '',
    r.court_reasoning ? `Reasoning: ${String(r.court_reasoning).slice(0, 2000)}` : '',
    r.final_disposition ? `Disposition: ${String(r.final_disposition).slice(0, 600)}` : '',
  ].filter(Boolean).join('\n');
}

// ── Reviewer notes ───────────────────────────────────────────────────

async function loadReviewerNotes(
  redTeamId: number,
  deliverableId: string | null,
  queryText: string,
  firmId: string,
): Promise<ReviewerNotes> {
  const supabase = getServiceDbForFirm(firmId);
  const out: ReviewerNotes = { suppressed: [], ownNotes: [], crossNotes: [] };

  const ownNoteIds = new Set<string>();
  if (deliverableId) {
    const { data: priorRuns } = await supabase
      .from('pleading_red_teams').select('id').eq('deliverable_id', deliverableId);
    const ids = (priorRuns ?? []).map((r) => r.id as number).filter((rid) => rid !== redTeamId);
    if (ids.length) {
      const { data: notes } = await supabase
        .from('pleading_red_team_comments')
        .select('id, finding_heading, body, verdict')
        .in('red_team_id', ids)
        .order('created_at', { ascending: true });
      for (const n of notes ?? []) {
        ownNoteIds.add(String(n.id));
        const entry = { heading: String(n.finding_heading ?? ''), body: String(n.body) };
        if (n.verdict === 'wrong') out.suppressed.push(entry);
        else out.ownNotes.push(entry);
      }
    }
  }

  if (queryText.trim()) {
    const hits = await searchEmbeddingsByType(queryText.slice(0, 2000), ['red_team_note'], {
      limit: 8,
      threshold: 0.3,
      firmId,
    }).catch(() => []);
    out.crossNotes = hits.filter((h) => !ownNoteIds.has(h.source_id)).map((h) => h.chunk_text);
  }

  return out;
}

function buildNotesBlock(notes: ReviewerNotes): string {
  const blocks: string[] = [];
  if (notes.suppressed.length) {
    blocks.push(
      `FINDINGS A LAWYER ALREADY REJECTED on a previous run of THIS pleading. They were wrong. Do NOT raise them again, and do not raise a rephrased version of them:\n` +
        notes.suppressed.map((n) => `- ${n.heading ? `"${n.heading}" — ` : ''}${n.body}`).join('\n'),
    );
  }
  if (notes.ownNotes.length) {
    blocks.push(
      `REVIEWER NOTES ON THIS PLEADING — authoritative context from the firm's lawyers. Apply them:\n` +
        notes.ownNotes.map((n) => `- ${n.heading ? `"${n.heading}" — ` : ''}${n.body}`).join('\n'),
    );
  }
  if (notes.crossNotes.length) {
    blocks.push(
      `REVIEWER GUIDANCE FROM OTHER PLEADINGS — apply only where it genuinely fits these facts; ignore it where it does not:\n` +
        notes.crossNotes.map((n) => `- ${n}`).join('\n'),
    );
  }
  return blocks.join('\n\n');
}

// ── Grounding block (built from the structured pieces, not the draft one) ──

function buildRecordBlock(g: DraftGrounding | null): string {
  if (!g) return '';
  const sections: string[] = [];

  if (g.briefBlock) {
    sections.push(`MATTER BRIEF (the facts and posture this pleading sits in):\n${g.briefBlock}`);
  }
  if (g.ownWork.length > 0) {
    sections.push(
      `THIS MATTER'S OWN RECORD — filings and documents already in THIS case. Read these for CONTRADICTIONS: a paragraph in the pleading that conflicts with a document already filed or received here is the single most damaging thing opposing counsel can find, because it is in the record and cannot be walked back:\n` +
        g.ownWork
          .map((w, i) => `[${i + 1}] ${w.title}${w.origin ? ` (${w.origin})` : ''}:\n${w.excerpt}`)
          .join('\n\n'),
    );
  }
  if (g.kbPages.length > 0) {
    sections.push(
      `FIRM KNOWLEDGE (our own doctrine and practice notes):\n` +
        g.kbPages.map((p) => `- ${p.title}: ${p.summary || p.snippet}`).join('\n'),
    );
  }
  if (g.authorities.length > 0) {
    sections.push(
      `DECISIONS RETRIEVED ON THIS MATTER'S SUBJECT (juris.ph semantic match — these are NOT necessarily favourable to us; read them for what they do to our position):\n` +
        g.authorities
          .map((a, i) => `[${i + 1}] ${a.caseNumber} — ${a.title}${a.date ? ` (${a.date})` : ''}${a.snippet ? `:\n${a.snippet}` : ''}`)
          .join('\n\n'),
    );
  }
  return sections.join('\n\n');
}

function buildAdverseBlock(authorities: AdverseAuthority[]): string {
  if (authorities.length === 0) return '';
  return (
    `ADVERSE AUTHORITY SEARCH — decisions found by searching juris.ph for rulings that would REFUTE this pleading's own propositions. ` +
    `Each is listed with the proposition of ours it was surfaced against. Read each one: if it genuinely cuts against us, that is a finding of category "contrary_authority" and it belongs near the top. ` +
    `If it does not actually apply — different facts, different statute, superseded — say nothing about it. A search hit is a lead, not a holding:\n\n` +
    authorities
      .map(
        (a, i) =>
          `[${i + 1}] ${a.caseNumber} — ${a.title}${a.date ? ` (${a.date})` : ''}\n` +
          `    Surfaced against our proposition: ${a.againstProposition}\n` +
          (a.snippet ? `    ${a.snippet}\n` : ''),
      )
      .join('\n')
  );
}

function buildCitationBlock(verified: VerifiedAuthority[], missing: CitationTarget[]): string {
  if (verified.length === 0 && missing.length === 0) return '';
  const parts: string[] = [
    `CITE-CHECK — every authority this pleading cites, looked up on juris.ph.`,
  ];
  if (verified.length > 0) {
    parts.push(
      `\nRETRIEVED — for each, decide whether the decision ACTUALLY supports the proposition it was cited for. ` +
        `A case cited for something it does not hold is the cheapest point opposing counsel will ever score, and it costs the firm credibility on everything else in the filing. ` +
        `Emit one citation_checks entry per authority with verdict "supports", "mismatch", or "unclear" (use "unclear" when the retrieved summary is too thin to judge — do not guess):\n\n` +
        verified
          .map(
            (v) =>
              `• ${v.target.ref} — ${v.title}${v.date ? ` (${v.date})` : ''}\n` +
              `  We cite it for: ${v.target.offered_for || '(the pleading does not make the proposition explicit)'}\n` +
              `  What juris.ph reports the decision holds:\n  ${v.holding.replace(/\n/g, '\n  ') || '(no summary available)'}\n`,
          )
          .join('\n'),
    );
  }
  if (missing.length > 0) {
    parts.push(
      `\nNOT IN JURIS.PH — juris.ph answered and has no record of these. Treat this as an exposure worth raising, but state it accurately: juris.ph indexes Supreme Court decisions and Republic Acts only and is not guaranteed complete, so this means the citation COULD NOT BE VERIFIED, not that it is fabricated. Do not emit citation_checks entries for these — they are added automatically:\n` +
        missing.map((m) => `• ${m.ref}${m.offered_for ? ` (cited for: ${m.offered_for})` : ''}`).join('\n'),
    );
  }
  return parts.join('\n');
}

// ── Tool schemas ─────────────────────────────────────────────────────

const RECON_TOOL = {
  name: 'emit_pleading_skeleton',
  description: 'Emit the structural skeleton of the pleading: what it argues, what it cites, and what it needs procedurally.',
  input_schema: {
    type: 'object' as const,
    properties: {
      document_type: { type: 'string', description: 'e.g. "Complaint", "Answer with Counterclaim", "Petition for Certiorari (Rule 65)", "Motion to Dismiss".' },
      relief_sought: { type: 'string', description: 'The relief prayed for, in one or two sentences.' },
      propositions: {
        type: 'array',
        description: 'Each distinct legal proposition the pleading must win on, most load-bearing first. 3-6 entries.',
        items: {
          type: 'object',
          properties: {
            proposition: { type: 'string', description: 'The proposition as the pleading asserts it, in one sentence.' },
            why_it_matters: { type: 'string', description: 'What fails if this proposition fails.' },
            supporting_citations: { type: 'array', items: { type: 'string' }, description: 'Citations the pleading offers for this proposition.' },
            contrary_query: {
              type: 'string',
              description:
                'A natural-language search query for Philippine Supreme Court decisions that would REFUTE this proposition — phrased from the losing side, describing the situation in which a court REJECTED it. Example: for "the action has not prescribed because the ten-year period runs from discovery of the fraud", write "reconveyance denied where the action was filed beyond the prescriptive period counted from registration of the title". Do NOT simply negate our sentence; describe the fact pattern of a decision going the other way.',
            },
          },
          required: ['proposition', 'why_it_matters', 'supporting_citations', 'contrary_query'],
        },
      },
      cited_authorities: {
        type: 'array',
        description: 'Every case (G.R./A.M./A.C. No.) and statute (RA) the pleading cites, copied VERBATIM as written, paired with the proposition it is offered for. Do not include Rules of Court provisions.',
        items: {
          type: 'object',
          properties: {
            citation: { type: 'string', description: 'The citation exactly as it appears in the document.' },
            offered_for: { type: 'string', description: 'The proposition the pleading uses it to support.' },
          },
          required: ['citation', 'offered_for'],
        },
      },
      threshold_items: {
        type: 'array',
        description: 'Procedural requirements this kind of pleading needs (verification, certification against forum shopping, proof of service, board resolution/SPA, jurisdictional amount, timeliness, barangay conciliation, exhaustion of administrative remedies) and whether each appears present on the face of the document.',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string' },
            present: { type: 'boolean' },
            note: { type: 'string' },
          },
          required: ['item', 'present', 'note'],
        },
      },
    },
    required: ['document_type', 'relief_sought', 'propositions', 'cited_authorities', 'threshold_items'],
  },
};

const TARGET_RECON_TOOL = {
  name: 'emit_target_skeleton',
  description: 'Emit the points this pleading makes that a responsive pleading has to meet.',
  input_schema: {
    type: 'object' as const,
    properties: {
      document_type: { type: 'string', description: 'e.g. "Complaint", "Motion to Dismiss", "Petition for Review".' },
      relief_sought: { type: 'string', description: 'The relief it prays for, in one or two sentences.' },
      points: {
        type: 'array',
        description:
          `Every point a response must meet, in document order, at most ${MAX_TARGET_POINTS}. For a complaint or petition: each MATERIAL allegation of ultimate fact, at the paragraph level — these are what a responsive pleading must specifically deny or be deemed to admit. For a motion or a brief: each GROUND or argument it advances. Split a paragraph that carries two distinct allegations; merge a run of purely narrative paragraphs.`,
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'Where it sits in THEIR pleading, as they number it — "¶ 12", "¶¶ 14-16", "Ground II", "Prayer". This is how the response is checked against it, so copy their numbering exactly.' },
            kind: { type: 'string', enum: ['allegation', 'ground', 'relief'], description: '"allegation" for an assertion of fact, "ground" for a legal ground or argument, "relief" for something in the prayer.' },
            text: { type: 'string', description: 'The point in one sentence, keeping their own words where it matters.' },
            requires_response: {
              type: 'boolean',
              description:
                'True when a responsive pleading has to deal with it — a material allegation of ultimate fact, or a ground for the relief they seek. False for formal recitals (names, addresses, capacity, jurisdictional boilerplate), evidentiary detail, and argument that merely restates an earlier point.',
            },
          },
          required: ['ref', 'kind', 'text', 'requires_response'],
        },
      },
    },
    required: ['document_type', 'relief_sought', 'points'],
  },
};

function buildAnalysisTool(hasTarget: boolean) {
  const categories = hasTarget ? [...FINDING_CATEGORIES, ...RESPONSIVE_CATEGORIES] : FINDING_CATEGORIES;
  return {
  name: 'emit_red_team',
  description: 'Emit the adversarial assessment of the pleading.',
  input_schema: {
    type: 'object' as const,
    properties: {
      document_type: { type: 'string' },
      overall_risk: { type: 'string', enum: ['severe', 'high', 'moderate', 'low'] },
      weakest_link: {
        type: 'string',
        description: 'The ONE point most likely to lose this pleading, and why — 2-4 sentences. Not a summary of the findings; a judgment about which single thing to fix first.',
      },
      opposing_theory: {
        type: 'string',
        description: 'The best case against us, written as continuous prose in opposing counsel\'s voice — 3-5 paragraphs. What is their theory, what do they lead with, and where do they want the court\'s attention.',
      },
      findings: {
        type: 'array',
        description: 'Concrete attacks, most damaging first.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: categories },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            heading: { type: 'string', description: 'One line naming the weakness, specific enough to be actionable on its own.' },
            location: { type: 'string', description: 'Where in the document — "¶ 12", "Prayer", "Certification", "Statement of Facts". Empty string if it cannot be pinned.' },
            our_text: { type: 'string', description: 'The passage under attack, quoted verbatim. Empty string when the weakness is something MISSING.' },
            is_omission: { type: 'boolean', description: 'True when the weakness is an absence rather than a passage.' },
            attack: { type: 'string', description: 'How opposing counsel exploits this — what they would actually argue or move for, in their voice.' },
            authority: { type: 'string', description: 'The rule, statute, case, or specific record document that backs the attack. Empty string only if the attack is purely factual.' },
            fix: { type: 'string', description: 'SELF mode: the concrete revision, added allegation, or preemptive paragraph that closes this. Empty string in OPPOSING mode.' },
            argument_line: { type: 'string', description: 'OPPOSING mode: a ready-to-adapt paragraph making this argument in our own responsive pleading. Empty string in SELF mode.' },
          },
          required: ['category', 'severity', 'confidence', 'heading', 'location', 'our_text', 'is_omission', 'attack', 'authority', 'fix', 'argument_line'],
        },
      },
      citation_checks: {
        type: 'array',
        description: 'One entry per RETRIEVED authority in the cite-check block. Omit authorities that were not retrieved.',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'The citation as given in the cite-check block.' },
            verdict: { type: 'string', enum: ['supports', 'mismatch', 'unclear'] },
            note: { type: 'string', description: 'For "mismatch", what the case actually holds and how the pleading overstates it. For "unclear", what could not be determined.' },
          },
          required: ['ref', 'verdict', 'note'],
        },
      },
      concessions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Things this pleading gives away for free — admissions, unnecessary narrowing, facts conceded that did not have to be. Empty array if none.',
      },
      ...(hasTarget ? {
        response_coverage: {
          type: 'array',
          description:
            'One entry for EVERY point listed in the RESPONDS TO block — including the ones that were met. Work down that list in order and do not skip a point; a point you leave out is reported to the lawyer as unchecked.',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'The ref exactly as given in the RESPONDS TO block ("¶ 12", "Ground II").' },
              status: {
                type: 'string',
                enum: ['addressed', 'partial', 'missing'],
                description: '"addressed" — squarely met. "partial" — touched but not squarely: a general denial where a specific one is required, a negative pregnant, a ground answered on only one of its limbs. "missing" — not dealt with at all.',
              },
              note: { type: 'string', description: 'For "partial" and "missing", what is left open and what it costs. Empty string for "addressed".' },
            },
            required: ['ref', 'status', 'note'],
          },
        },
      } : {}),
    },
    required: [
      'document_type', 'overall_risk', 'weakest_link', 'opposing_theory', 'findings',
      'citation_checks', 'concessions', ...(hasTarget ? ['response_coverage'] : []),
    ],
  },
  };
}

// ── Prompts ──────────────────────────────────────────────────────────

const RECON_SYSTEM = `You are a Philippine litigation associate reading a pleading to map its structure before it is stress-tested. You are NOT evaluating it yet — extract only.

Identify what kind of pleading it is, what relief it seeks, the legal propositions it must win on, every case and statute it cites and what each is cited FOR, and the procedural requirements this kind of pleading carries.

The most important field is "contrary_query" on each proposition. It is fed to a semantic search of Philippine Supreme Court decisions to find rulings that go AGAINST us. Write it as a description of the fact pattern of a decision REJECTING our proposition, not as a negation of our sentence. A good query names the doctrine, the posture, and the reason a court would rule the other way.

Return the result by calling emit_pleading_skeleton.`;

const TARGET_RECON_SYSTEM = `You are a Philippine litigation associate reading a pleading in order to build the checklist a response to it will be measured against. You are NOT evaluating it and you are not drafting the response — extract only.

Work through the document in order and list every point a responsive pleading has to meet: for a complaint or petition, each material allegation of ultimate fact at the paragraph level; for a motion or a brief, each ground it advances. Copy their own numbering into "ref" — the response is checked point by point against these refs, and a ref that does not match their document is worse than useless.

Be accurate about "requires_response". Marking a formal recital as requiring a response manufactures a defect in the answer; missing a material allegation lets a deemed admission through.

Return the result by calling emit_target_skeleton.`;

/**
 * The checklist block: their points, plus the doctrine that makes an incomplete
 * response expensive. Read from the perspective of whoever filed the document
 * under review — in OPPOSING mode the gaps are the other side's, and each one
 * is an argument we get to make.
 */
function buildTargetBlock(
  skeleton: TargetSkeleton,
  mode: RedTeamMode,
  fileName: string,
): string {
  const points = (skeleton.points ?? []).filter((p) => (p?.text ?? '').trim());
  if (points.length === 0) return '';

  const whose = mode === 'self' ? 'OUR' : 'THEIR';
  const framing = mode === 'self'
    ? `The document under review is ${whose} response to it. Its job is to meet every point below; a point it does not meet is a hole opposing counsel already has the paper for.`
    : `The document under review is ${whose} response to it — the pleading below is OURS. Every point of ours they failed to meet is an argument we make in reply: say so in the finding and give the argument line.`;

  const doctrine = `WHAT AN INCOMPLETE RESPONSE COSTS — apply this to each point:
- Rule 8, Sec. 10 — a denial must be specific: deny each material allegation and set forth the substance of the matter relied on, or specify what is admitted and deny the rest. A blanket "denies the allegations in paragraphs 5 to 20" is a general denial.
- Rule 8, Sec. 11 — a material allegation not specifically denied is DEEMED ADMITTED (except unliquidated damages). This is the single most expensive thing a responsive pleading can get wrong, and it is invisible from the response alone. Category "unanswered_allegation".
- Negative pregnant — a denial in the exact words of the allegation admits the substance while appearing to deny it. Treat as "partial", not "addressed".
- Rule 9, Sec. 1 — defenses and objections not pleaded are WAIVED, except lack of jurisdiction over the subject matter, litis pendentia, res judicata and prescription, which the court may act on motu proprio. A defense the record below plainly supports but the response omits is category "waived_defense".
- Rule 6, Sec. 7 and Rule 9, Sec. 2 — a compulsory counterclaim not set up is barred.
- A ground or argument left standing without an answer is category "unrebutted_argument". Silence on a ground is not a strategy the court reads charitably.

Do not invent a gap. If the response deals with a point somewhere other than where you expect — in the affirmative defenses, in the prayer, by incorporation — that point is addressed. Quote what met it.`;

  return (
    `THE PLEADING THIS ONE RESPONDS TO — "${fileName}"${skeleton.document_type ? `, a ${skeleton.document_type}` : ''}. ` +
    `${framing}${skeleton.relief_sought ? ` It prays for: ${skeleton.relief_sought}` : ''}\n\n` +
    `POINTS IT MAKES — emit one response_coverage entry for EVERY line here, using the ref exactly as written:\n` +
    points
      .map((p) => `- [${p.ref}] (${p.kind}${p.requires_response === false ? ', formal — no response required' : ''}) ${p.text}`)
      .join('\n') +
    `\n\n${doctrine}`
  );
}

function buildAnalysisSystem(
  mode: RedTeamMode,
  documentType: string,
  recordBlock: string,
  adverseBlock: string,
  citationBlock: string,
  notesBlock: string,
  thresholdBlock: string,
  targetBlock: string,
): string {
  const roleBlock = mode === 'self'
    ? `MODE = SELF. This is OUR OWN draft, not yet filed. Your job is to attack it as opposing counsel would, so we can fix it first. For every finding, fill "fix" with the concrete revision, added allegation, or preemptive paragraph that closes the hole, and leave "argument_line" as an empty string. Be harder on us than opposing counsel will be — a weakness you decline to name here is one we find out about in a comment or a motion to dismiss.`
    : `MODE = OPPOSING. This is the ADVERSE party's filing and we are preparing our response. Every weakness you find is an argument WE get to make. For every finding, fill "argument_line" with a ready-to-adapt paragraph making that argument in our responsive pleading, stating the ground and citation, and leave "fix" as an empty string. "our_text" means THEIR text, and "attack" means our attack on it.`;

  return `You are a senior Philippine litigator. You have been handed a ${documentType || 'pleading'} and told to find everything wrong with it — not stylistically, but everything that could actually cost the case.

${roleBlock}

WHAT TO LOOK FOR (use these exact keys for "category"):
- procedural — Rules of Court defects: verification (Rule 7, Sec. 4), certification against forum shopping (Rule 7, Sec. 5), proof of service, wrong mode of review (Rule 45 vs Rule 65), failure to implead an indispensable party (Rule 3, Sec. 7), no board resolution or SPA for the signatory, non-exhaustion of administrative remedies, no prior barangay conciliation where the Katarungang Pambarangay applies.
- jurisdiction — subject-matter jurisdiction (BP 129 as amended by RA 11576), jurisdictional amount, improper venue, an agency's primary jurisdiction.
- prescription — the prescriptive period, its reckoning date, laches.
- evidentiary_gap — an allegation with nothing behind it: annex not attached or not authenticated, a fact that only hearsay can prove, contents of a writing without the original (Rule 130, Sec. 3), no competent witness for a material fact.
- authority_misuse — a cited case that does not hold what we say it holds, obiter treated as ratio, a doctrine since abandoned or superseded, a case distinguishable on its controlling facts.
- contrary_authority — a decision that goes against our position.
- missing_element — an element of the cause of action or defense not pleaded; conclusions instead of the ultimate facts Rule 8, Sec. 1 requires.
- internal_inconsistency — the pleading contradicts itself.
- record_contradiction — the pleading contradicts a document already in this matter's record.
- admission_against_interest — a paragraph that concedes something, including a judicial admission under Rule 129, Sec. 4.
- overclaim — asserting more than the facts carry, inviting a demurrer (Rule 33).
- remedy_mismatch — the relief prayed for does not follow from the cause pleaded, or the wrong remedy was chosen.
- pleading_defect — failure to state a cause of action, defective form under Rule 8.
- vagueness — an allegation so indefinite it invites a bill of particulars (Rule 12).
${targetBlock ? `- unanswered_allegation — a material allegation in the pleading being answered that this one fails to specifically deny (Rule 8, Sec. 11).
- waived_defense — a defense or objection available on this record that this pleading omits, and thereby waives (Rule 9, Sec. 1).
- unrebutted_argument — a ground or argument in the pleading being answered that this one leaves standing.
` : ''}
THREE RULES. They decide whether this tool gets used or ignored:

1. NEVER INVENT AUTHORITY. Cite only from the adverse-authority list, the cite-check block, the matter record below, the Rules of Court, or statutes you are certain of. If you believe contrary authority exists but none was supplied, say so in the finding as an unverified concern and set confidence to "low" — do NOT produce a case number. A fabricated citation in a red-team report is worse than no report.

2. EVERY FINDING MUST NAME A REAL ATTACK. State what opposing counsel would actually file — a motion, a ground, an objection, a line of cross — backed by a rule, a case, or a specific document in the record. Do not emit findings like "consider adding more detail", "this could be strengthened", "the argument would benefit from more support". Those have no adversary behind them and they bury the findings that do. If you cannot name who attacks it and how, it is not a finding. A short list of real problems is worth far more than a long list that has to be triaged.

3. BE HONEST ABOUT CONFIDENCE. Set confidence to "low" whenever you are inferring from a record you cannot see — annexes not attached, prior filings not before you, facts outside the four corners of the document. A low-confidence finding is still worth raising; dressing it up as high-confidence is what makes a lawyer stop trusting the tool. Severity is how much it costs if it lands; confidence is how sure you are that it lands. They are independent — a "critical" finding can be "low" confidence.

Rank findings by what actually threatens the case. A missing certification against forum shopping is worth more than three paragraphs of imprecise phrasing. Cap yourself at the findings that matter; do not pad.

${targetBlock ? `\n${targetBlock}\n` : ''}${thresholdBlock ? `\n${thresholdBlock}\n` : ''}${recordBlock ? `\n${recordBlock}\n` : ''}${adverseBlock ? `\n${adverseBlock}\n` : ''}${citationBlock ? `\n${citationBlock}\n` : ''}${notesBlock ? `\n${notesBlock}\n` : ''}
This is decision-support for a lawyer, not legal advice, and every authority named here must be read in full before it is relied on or distinguished in a filing.`;
}

// ── Document loading ─────────────────────────────────────────────────

interface LoadedDocument {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any[];
  extractedText: string;
  claudeFileId: string | null;
}

async function loadDocument(
  firmId: string,
  storagePath: string,
  fileName: string,
  opts: { heading?: string; maxChars?: number } = {},
): Promise<LoadedDocument> {
  const heading = opts.heading ?? 'PLEADING';
  const maxChars = opts.maxChars ?? 120_000;
  const supabase = getSupabase(); // storage-only: raw client for the handle
  const { data: blob, error: dlErr } = await supabase.storage.from('files').download(storagePath);
  if (dlErr || !blob) throw new Error(`Could not download file: ${dlErr?.message ?? 'no data'}`);
  const buffer = Buffer.from(await blob.arrayBuffer());

  const ext = (fileName || '').split('.').pop()?.toLowerCase() ?? '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [];
  let extractedText = '';
  let claudeFileId: string | null = null;

  if (ext === 'pdf') {
    claudeFileId = await uploadToClaudeFiles({ firmId, feature: 'red_team' }, buffer, fileName || 'pleading.pdf');
    content.push({ type: 'document', source: { type: 'file', file_id: claudeFileId } });
    try {
      const parsed = await extractPdfText(buffer);
      extractedText = (parsed.text || '').trim();
    } catch { /* the citation sweep falls back to what the recon pass reports */ }
  } else {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    let text = (value || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text || text.length < 10) {
      throw new Error('Could not extract text from the document (it may be a scanned image without OCR).');
    }
    if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n\n[Document truncated]`;
    extractedText = text;
    content.push({ type: 'text', text: `--- ${heading} ("${fileName}") ---\n\n${text}\n\n--- END OF ${heading} ---` });
  }

  return { content, extractedText, claudeFileId };
}

/**
 * Map the pleading being answered into the checklist the response is measured
 * against. Cheap model, same as the recon pass, and run alongside it.
 */
async function reconTarget(
  claude: Anthropic,
  doc: LoadedDocument,
): Promise<{ skeleton: TargetSkeleton; inputTokens: number; outputTokens: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: RECON_MODEL,
    max_tokens: 8192,
    system: TARGET_RECON_SYSTEM,
    tools: [TARGET_RECON_TOOL],
    tool_choice: { type: 'tool', name: TARGET_RECON_TOOL.name },
    messages: [{
      role: 'user',
      content: [
        ...doc.content,
        { type: 'text', text: `List the points this pleading makes that a response has to meet. Return the result by calling ${TARGET_RECON_TOOL.name}.` },
      ],
    }],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = doc.claudeFileId
    ? await withRetry(() => claude.beta.messages.create({ ...params, betas: ['files-api-2025-04-14'] }))
    : await withRetry(() => claude.messages.create(params));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const use = (res.content as any[]).find((b) => b.type === 'tool_use');
  if (!use?.input) throw new Error('Could not read the structure of the pleading being answered');
  const skeleton = use.input as TargetSkeleton;

  return {
    skeleton: {
      document_type: skeleton.document_type || '',
      relief_sought: skeleton.relief_sought || '',
      points: toolArray<(typeof skeleton.points)[number]>(skeleton.points).slice(0, MAX_TARGET_POINTS),
    },
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  };
}

// ── Entry point ──────────────────────────────────────────────────────

/**
 * Run the adversarial review for a pending pleading_red_teams row. Idempotent:
 * only acts on a 'pending' row, flips it to 'processing', then 'completed' or
 * 'failed'. Called from the route's after() so it survives the response.
 */
export async function redTeamPleading(redTeamId: number, firmId: string): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);

  const { data: run } = await supabase
    .from('pleading_red_teams').select('*').eq('id', redTeamId).maybeSingle();
  if (!run) return;
  if (run.status !== 'pending') return;

  await supabase.from('pleading_red_teams').update({ status: 'processing' }).eq('id', redTeamId);

  try {
    if (!run.storage_path) throw new Error('No file path on the review row');
    const mode: RedTeamMode = run.mode === 'opposing' ? 'opposing' : 'self';

    const { content, extractedText, claudeFileId } = await loadDocument(firmId, run.storage_path, run.file_name);
    const claude = await anthropicFor({ firmId, feature: 'red_team' });

    // The pleading this one answers, when the lawyer supplied it. It is loaded
    // before anything expensive runs: if it cannot be read, the run fails here
    // rather than producing a report whose silence on the other side's
    // allegations would read as "nothing was left unanswered".
    const targetDoc = run.target_storage_path
      ? await loadDocument(firmId, run.target_storage_path, run.target_file_name || 'pleading being answered', {
          heading: 'PLEADING BEING ANSWERED',
          maxChars: 80_000,
        }).catch((err: unknown) => {
          const m = err instanceof Error ? err.message : 'unknown error';
          throw new Error(`Could not read the pleading being answered ("${run.target_file_name || 'file'}"): ${m}`);
        })
      : null;

    // The deliverable's subtype is a better document-type hint than the filename.
    let subtypeHint = '';
    if (run.deliverable_id) {
      const { data: deliv } = await supabase
        .from('deliverables').select('subtype, name').eq('notion_id', run.deliverable_id).maybeSingle();
      subtypeHint = deliv?.subtype || '';
    }

    // ── Pass 1: recon ────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reconParams: any = {
      model: RECON_MODEL,
      max_tokens: 4096,
      system: RECON_SYSTEM,
      tools: [RECON_TOOL],
      tool_choice: { type: 'tool', name: RECON_TOOL.name },
      messages: [{
        role: 'user',
        content: [
          ...content,
          {
            type: 'text',
            text: `Map this pleading's structure${subtypeHint ? ` (the firm has it tagged as a "${subtypeHint}")` : ''}. Return the result by calling ${RECON_TOOL.name}.`,
          },
        ],
      }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [reconRes, target]: [any, Awaited<ReturnType<typeof reconTarget>> | null] = await Promise.all([
      claudeFileId
        ? withRetry(() => claude.beta.messages.create({ ...reconParams, betas: ['files-api-2025-04-14'] }))
        : withRetry(() => claude.messages.create(reconParams)),
      targetDoc ? reconTarget(claude, targetDoc) : Promise.resolve(null),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reconUse = (reconRes.content as any[]).find((b) => b.type === 'tool_use');
    if (!reconUse?.input) throw new Error('Could not read the pleading\'s structure');
    const skeleton = reconUse.input as PleadingSkeleton;
    const propositions = toolArray<(typeof skeleton.propositions)[number]>(skeleton.propositions);
    const documentType = skeleton.document_type || subtypeHint || 'pleading';

    // ── Pass 2: evidence ─────────────────────────────────────────────
    const citationTargets = reconcileCitations(toolArray(skeleton.cited_authorities), extractedText);
    const propositionQuery = propositions.map((p) => p.proposition).join('. ').slice(0, 600);

    const [grounding, adverse, cites, notes] = await Promise.all([
      run.matter_id
        ? assembleDraftGrounding({
            firmId,
            matterId: run.matter_id,
            documentType,
            extraQuery: propositionQuery,
            includeAuthorities: true,
            skipStyle: true,
          }).catch(() => null)
        : Promise.resolve(null),
      findAdverseAuthorities(propositions),
      verifyCitedAuthorities(citationTargets),
      loadReviewerNotes(redTeamId, run.deliverable_id, `${documentType}. ${propositionQuery}`, firmId),
    ]);

    const adverseSearchAvailable = jurisAvailability(adverse.attempted, adverse.reachable);
    const citeCheckAvailable = jurisAvailability(cites.attempted, cites.reachable);

    const thresholdItems = toolArray<(typeof skeleton.threshold_items)[number]>(skeleton.threshold_items);
    const thresholdBlock = thresholdItems.length
      ? `PROCEDURAL REQUIREMENTS read off the face of the document during an earlier pass (verify each — the pass was a skim and may be wrong about what is present):\n` +
        thresholdItems
          .map((t) => `- ${t.item}: ${t.present ? 'appears present' : 'NOT FOUND'}${t.note ? ` — ${t.note}` : ''}`)
          .join('\n')
      : '';

    // ── Pass 3: adversarial analysis ─────────────────────────────────
    const targetBlock = target
      ? buildTargetBlock(target.skeleton, mode, run.target_file_name || 'the pleading being answered')
      : '';

    const system = buildAnalysisSystem(
      mode,
      documentType,
      buildRecordBlock(grounding),
      buildAdverseBlock(adverse.authorities),
      buildCitationBlock(cites.verified, cites.missing),
      buildNotesBlock(notes),
      thresholdBlock,
      targetBlock,
    );

    const instruction = mode === 'self'
      ? 'Attack this pleading. Return the result by calling emit_red_team. Order findings by what would actually cost us the case, not by where they appear in the document.'
      : 'Take this filing apart so we can respond to it. Return the result by calling emit_red_team. Order findings by which arguments are strongest for us.';

    // Two documents in one message: label each, or the model reviews the wrong
    // one and every "our_text" quote comes from the other side's paper.
    const analysisContent = targetDoc
      ? [
          { type: 'text', text: `DOCUMENT UNDER REVIEW — "${run.file_name}". Every finding, quote and location you emit refers to THIS document.` },
          ...content,
          { type: 'text', text: `THE PLEADING IT RESPONDS TO — "${run.target_file_name}". Do not review this one. It is here so you can check what the document under review does and does not meet.` },
          ...targetDoc.content,
        ]
      : content;

    const analysisTool = buildAnalysisTool(!!target);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const analysisParams: any = {
      model: ANALYSIS_MODEL,
      max_tokens: 16384,
      system,
      tools: [analysisTool],
      tool_choice: { type: 'tool', name: analysisTool.name },
      messages: [{ role: 'user', content: [...analysisContent, { type: 'text', text: instruction }] }],
    };
    // Either document being a PDF puts a Files API reference in the message.
    const usesFilesApi = !!claudeFileId || !!targetDoc?.claudeFileId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = usesFilesApi
      ? await withRetry(() => claude.beta.messages.create({ ...analysisParams, betas: ['files-api-2025-04-14'] }))
      : await withRetry(() => claude.messages.create(analysisParams));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = (response.content as any[]).find((b) => b.type === 'tool_use');
    if (!toolUse?.input || typeof toolUse.input !== 'object') {
      throw new Error('Model did not return a structured assessment');
    }

    const out = toolUse.input as {
      document_type?: string;
      overall_risk?: string;
      weakest_link?: string;
      opposing_theory?: string;
      findings?: RedTeamFinding[];
      citation_checks?: { ref: string; verdict: 'supports' | 'mismatch' | 'unclear'; note: string }[];
      concessions?: string[];
      response_coverage?: ModelCoverage[];
    };

    const findings = toolArray<NonNullable<typeof out.findings>[number]>(out.findings);
    const severity = rollUpSeverity(findings);

    // Merge the model's verdicts on retrieved authorities with the ones
    // juris.ph does not have. The latter are a fact about the lookup, not a
    // judgment, so they are appended here rather than left to the model.
    const verdictByRef = matchVerdictsToTargets(
      cites.verified.map((v) => v.target.ref),
      toolArray(out.citation_checks),
    );
    const citationChecks: CitationCheck[] = [
      ...cites.verified.map((v): CitationCheck => {
        const judged = verdictByRef.get(v.target.ref);
        return {
          ref: v.target.ref,
          kind: v.target.kind,
          offered_for: v.target.offered_for,
          status: 'found',
          verdict: judged?.verdict ?? 'unclear',
          title: v.title,
          url: v.url,
          date: v.date,
          note: judged?.note ?? '',
        };
      }),
      ...cites.missing.map((m): CitationCheck => ({
        ref: m.ref,
        kind: m.kind,
        offered_for: m.offered_for,
        status: 'not_found',
        verdict: 'unverified',
        note: 'juris.ph has no record of this citation. Its corpus is Supreme Court decisions and Republic Acts only, so verify against the official report before treating it as wrong — and before opposing counsel does.',
      })),
    ];

    const coverage = target ? mergeCoverage(target.skeleton.points, toolArray(out.response_coverage)) : [];

    const truncated = response.stop_reason === 'max_tokens';
    const weakestLink = truncated
      ? `${out.weakest_link ?? ''}\n\nNote: the pleading was long and this assessment may be incomplete (the analysis hit its length limit).`.trim()
      : (out.weakest_link ?? '');

    await supabase.from('pleading_red_teams').update({
      status: 'completed',
      document_type: out.document_type || documentType,
      overall_risk: out.overall_risk ?? null,
      weakest_link: weakestLink,
      opposing_theory: out.opposing_theory ?? '',
      findings,
      severity_breakdown: severity,
      finding_count: findings.length,
      adverse_authorities: adverse.authorities.length ? adverse.authorities : null,
      citation_checks: citationChecks.length ? citationChecks : null,
      concessions: toolArray<string>(out.concessions).length ? toolArray<string>(out.concessions) : null,
      adverse_search_available: adverseSearchAvailable,
      cite_check_available: citeCheckAvailable,
      target_document_type: target?.skeleton.document_type || null,
      target_digest: target ? target.skeleton : null,
      response_coverage: coverage.length ? coverage : null,
      claude_file_id: claudeFileId,
      token_count_input:
        (reconRes.usage?.input_tokens ?? 0) + (response.usage?.input_tokens ?? 0) + (target?.inputTokens ?? 0),
      token_count_output:
        (reconRes.usage?.output_tokens ?? 0) + (response.usage?.output_tokens ?? 0) + (target?.outputTokens ?? 0),
      model_used: ANALYSIS_MODEL,
      completed_at: new Date().toISOString(),
    }).eq('id', redTeamId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[red-team] review failed:', message);
    await supabase.from('pleading_red_teams').update({
      status: 'failed',
      error_message: message,
      completed_at: new Date().toISOString(),
    }).eq('id', redTeamId);
  }
}
