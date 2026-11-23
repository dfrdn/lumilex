// Drafting Studio — grounding assembly.
// Before drafting a document, gather the three things that make a draft
// firm-quality instead of generic:
//   1. the matter brief (facts, posture, claims, rulings, parties)
//   2. the firm's own prior filings most relevant to what's being drafted
//      (deliverable_version embeddings — reusable structure + language)
//   3. relevant firm-wide knowledge pages (doctrine, template clauses,
//      court practice) from the KMS
// Returns a prompt block to inject plus the structured sources, so the UI
// can show exactly what a draft was grounded on.

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { searchEmbeddingsByType } from '@/lib/ai/embeddings';
import { semanticKbSearch, type KbSearchHit } from '@/lib/ai/kb-search';
import { getStyleProfileForDraft } from '@/lib/ai/style-profile';
import { searchJurisprudence, topJurisprudenceHits, type JurisCaseHit } from '@/lib/juris';

export interface PriorWorkSource {
  deliverableId: string | null;
  title: string;
  matterName: string;
  excerpt: string;
  similarity: number;
  /** file_analyses.id backing this exemplar — lets us pull its full text. */
  analysisId: number | null;
}

/** A document already in THIS matter's record (its own filings / received docs). */
export interface MatterRecordSource {
  title: string;
  origin: string; // e.g. 'Incoming', 'Outgoing'
  excerpt: string;
  similarity: number;
}

/** An on-point SC decision pulled live from juris.ph at grounding time. */
export interface AuthoritySource {
  caseNumber: string;
  title: string;
  date?: string;
  snippet?: string;
  url: string;
  /** juris.ph semantic score. Exact-title matches come back scoreless → 1. */
  similarity: number;
}

export interface DraftGrounding {
  matterId: string;
  briefBlock: string;
  /** Relevant documents from the matter's own record (same-matter). */
  ownWork: MatterRecordSource[];
  /** Relevant filings from OTHER matters, as drafting exemplars (cross-matter). */
  priorWork: PriorWorkSource[];
  kbPages: KbSearchHit[];
  /** SC decisions from juris.ph matching the document + matter's legal shape. */
  authorities: AuthoritySource[];
  /** The assembled block to inject into the drafting prompt. */
  promptBlock: string;
}

interface BriefRow {
  summary: string | null;
  posture: string | null;
  court_and_venue: string | null;
  parties: unknown;
  claims_and_defenses: unknown;
  key_rulings: unknown;
}

/**
 * Assemble grounding for drafting `documentType` on `matterId`. `query`
 * defaults to the document type + the matter's posture/claims so retrieval
 * surfaces the most relevant prior work and doctrine.
 */
export async function assembleDraftGrounding(opts: {
  firmId: string;
  matterId: string;
  documentType: string;
  extraQuery?: string;
  /**
   * Sources the drafter curated out in the studio. Keys mirror what the
   * grounding preview shows: own-work by title, prior work by deliverable id
   * (or title when it has none), KB pages by id.
   */
  exclude?: {
    ownWorkTitles?: string[];
    priorWorkKeys?: string[];
    kbPageIds?: number[];
    authorityCaseNumbers?: string[];
  };
  /** Skip the live juris.ph pass (e.g. status reports — factual, not doctrinal). */
  includeAuthorities?: boolean;
  /**
   * Skip the house-style profile and the closest-exemplar full text. Both exist
   * to make a NEW draft read like the firm's work; a consumer that critiques an
   * existing document (Red Team) has no use for them and would pay a DB round
   * trip plus a large prompt block for nothing.
   */
  skipStyle?: boolean;
}): Promise<DraftGrounding> {
  const supabase = getServiceDbForFirm(opts.firmId);

  const { data: brief } = await supabase
    .from('matter_summaries')
    .select('summary, posture, court_and_venue, parties, claims_and_defenses, key_rulings')
    .eq('matter_id', opts.matterId)
    .maybeSingle<BriefRow>();

  // Build the retrieval query from the document + the matter's legal shape.
  const claimsText = summarizeJson(brief?.claims_and_defenses);
  const query = [opts.documentType, opts.extraQuery, brief?.posture, claimsText]
    .filter(Boolean)
    .join('. ')
    .slice(0, 600);

  const exAuth = new Set(opts.exclude?.authorityCaseNumbers ?? []);
  const [ownWorkAll, priorWorkAll, kbPagesAll, styleProfile, authorities] = await Promise.all([
    retrieveOwnMatterWork(query, opts.matterId, opts.firmId),
    retrievePriorWork(query, opts.matterId, opts.firmId),
    semanticKbSearch(query, { firmId: opts.firmId, limit: 5, kinds: ['doctrine', 'template_clause', 'court'] }),
    opts.skipStyle ? Promise.resolve(null) : getStyleProfileForDraft(opts.documentType, opts.firmId),
    opts.includeAuthorities === false
      ? Promise.resolve([] as AuthoritySource[])
      : retrieveAuthorities(query, exAuth),
  ]);

  // Drop any sources the drafter curated out, so both the injected prompt and
  // the returned "grounded on" summary reflect exactly what was used.
  const exOwn = new Set((opts.exclude?.ownWorkTitles ?? []).map((t) => t.toLowerCase()));
  const exPrior = new Set(opts.exclude?.priorWorkKeys ?? []);
  const exKb = new Set(opts.exclude?.kbPageIds ?? []);
  const ownWork = ownWorkAll.filter((w) => !exOwn.has(w.title.toLowerCase()));
  const priorWork = priorWorkAll.filter((w) => !exPrior.has(w.deliverableId ?? w.title));
  const kbPages = kbPagesAll.filter((p) => !exKb.has(p.id));

  const briefBlock = brief?.summary
    ? [
        brief.summary,
        brief.posture ? `Posture: ${brief.posture}` : '',
        brief.court_and_venue ? `Court/venue: ${brief.court_and_venue}` : '',
        claimsText ? `Claims/defenses: ${claimsText}` : '',
        summarizeJson(brief.key_rulings) ? `Key rulings: ${summarizeJson(brief.key_rulings)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  // The single closest exemplar, in fuller form: the model sees the whole
  // STRUCTURE (section order, headings, prayer, house phrasing) instead of a
  // 400-char fragment — the biggest lever on "drafts like our own work".
  const closest = opts.skipStyle ? null : priorWork[0];
  const closestExemplar = closest
    ? { title: closest.title, matterName: closest.matterName, text: await fetchExemplarFullText(closest.analysisId, opts.firmId) }
    : null;

  const promptBlock = buildPromptBlock(briefBlock, ownWork, priorWork, kbPages, authorities, closestExemplar, styleProfile);

  return { matterId: opts.matterId, briefBlock, ownWork, priorWork, kbPages, authorities, promptBlock };
}

// Short-TTL cache for the juris.ph leg: the grounding preview re-fires on
// every settled keystroke and generate repeats the preview's exact query, so
// without this each draft costs several identical external searches against a
// free no-SLA service. The corpus changes daily; 5 minutes is safely fresh.
// Outages are cached briefly too, so one slow failure doesn't repeat per keystroke.
const AUTHORITY_CACHE_TTL_MS = 5 * 60_000;
const AUTHORITY_OUTAGE_TTL_MS = 60_000;
const authorityCache = new Map<string, { at: number; hits: JurisCaseHit[] | null }>();

async function searchAuthoritiesCached(query: string): Promise<JurisCaseHit[] | null> {
  const cached = authorityCache.get(query);
  if (cached) {
    const ttl = cached.hits === null ? AUTHORITY_OUTAGE_TTL_MS : AUTHORITY_CACHE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.hits;
  }
  // Interactive surface — fail fast rather than pin the preview panel to the
  // client's default 12s timeout.
  const hits = await searchJurisprudence(query, { limit: 8, timeoutMs: 3500 });
  if (authorityCache.size > 100) authorityCache.clear();
  authorityCache.set(query, { at: Date.now(), hits });
  return hits;
}

/**
 * Live semantic search of juris.ph for the document + matter's legal shape.
 * Best-effort: an outage yields [] and the draft proceeds without authorities.
 * The drafter's exclusions apply BEFORE the cap so curating one out backfills
 * from the next-best qualifying hit.
 */
async function retrieveAuthorities(query: string, exclude: Set<string>): Promise<AuthoritySource[]> {
  const hits = await searchAuthoritiesCached(query);
  if (hits === null) return [];
  return topJurisprudenceHits(
    hits.filter((h) => !exclude.has(h.case_number)),
    { limit: 4 },
  ).map((h) => ({
    caseNumber: h.case_number,
    title: (h.case_title ?? h.case_number).slice(0, 200),
    date: h.decision_date,
    snippet: h.facts?.slice(0, 300),
    url: h.url,
    similarity: h.score,
  }));
}

/**
 * Pull an exemplar's fuller text from its analysis. Structure lives at the two
 * ends of a filing — the opening (caption, prefatory statement, section
 * headings) and the close (PRAYER/WHEREFORE, signature) — so keep the head and
 * tail and drop the middle when it's long, staying within a sane token budget.
 */
async function fetchExemplarFullText(analysisId: number | null, firmId: string): Promise<string | null> {
  if (!analysisId) return null;
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('file_analyses')
    .select('extracted_text')
    .eq('id', analysisId)
    .maybeSingle<{ extracted_text: string | null }>();
  const text = data?.extracted_text?.trim();
  if (!text) return null;

  const HEAD = 4500;
  const TAIL = 2000;
  if (text.length <= HEAD + TAIL + 200) return text;
  return `${text.slice(0, HEAD)}\n\n[… middle of the filing omitted …]\n\n${text.slice(-TAIL)}`;
}

/**
 * The matter's OWN relevant documents — its prior filings and the documents it
 * has received. Searches same-matter embeddings across the firm's outgoing work
 * (deliverable_version) and analyzed documents (file_analysis); many matters
 * (esp. Notion-migrated ones) have their filings only as file_analysis, not
 * deliverable_version, so searching both is what actually surfaces the record.
 */
async function retrieveOwnMatterWork(query: string, matterId: string, firmId: string): Promise<MatterRecordSource[]> {
  const matches = await searchEmbeddingsByType(query, ['deliverable_version', 'file_analysis'], {
    limit: 40,
    threshold: 0.2,
    matterId,
    firmId,
  });
  if (matches.length === 0) return [];

  // Collapse to distinct documents by title (a file can have several analysis
  // chunks/rows), keeping the best-matching excerpt for each.
  const bestByTitle = new Map<string, MatterRecordSource>();
  for (const m of matches) {
    const md = (m.metadata ?? {}) as Record<string, unknown>;
    const title = (String(md.deliverableName || md.fileName || '').trim()) || 'Document';
    const key = title.toLowerCase();
    const existing = bestByTitle.get(key);
    if (!existing || m.similarity > existing.similarity) {
      bestByTitle.set(key, {
        title,
        origin: String(md.origin || ''),
        excerpt: m.chunk_text.slice(0, 400),
        similarity: m.similarity,
      });
    }
  }

  return [...bestByTitle.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

/** Prior filings — best similarity per distinct DELIVERABLE, cross-matter only. */
async function retrievePriorWork(query: string, matterId: string, firmId: string): Promise<PriorWorkSource[]> {
  // The RPC LIMIT counts chunks; one long filing's many chunks can fill a
  // small window. Over-fetch so the collapse to distinct deliverables still
  // yields a useful set.
  const versionMatches = await searchEmbeddingsByType(query, ['deliverable_version'], { limit: 80, threshold: 0.2, firmId });
  if (versionMatches.length === 0) return [];

  // file_analyses.id is the source_id for deliverable_version embeddings.
  const bestByAnalysis = new Map<string, { similarity: number; excerpt: string }>();
  for (const m of versionMatches) {
    const cur = bestByAnalysis.get(m.source_id);
    if (!cur || m.similarity > cur.similarity) {
      bestByAnalysis.set(m.source_id, { similarity: m.similarity, excerpt: m.chunk_text.slice(0, 400) });
    }
  }

  const analysisIds = [...bestByAnalysis.keys()].map(Number).filter((n) => !Number.isNaN(n));
  if (analysisIds.length === 0) return [];

  const supabase = getServiceDbForFirm(firmId);
  const { data: analyses } = await supabase
    .from('file_analyses')
    .select('id, deliverable_file_id')
    .in('id', analysisIds);
  if (!analyses) return [];

  const dfIds = analyses.map((a) => a.deliverable_file_id).filter((x): x is number => x != null);
  const dfMap = new Map<number, { deliverable_id: string; deliverable_name: string | null; matter_name: string | null; matter_id: string | null }>();
  if (dfIds.length > 0) {
    const { data: dfRows } = await supabase
      .from('v_deliverable_version_lookup')
      .select('deliverable_file_id, deliverable_id, deliverable_name, matter_name, matter_id')
      .in('deliverable_file_id', dfIds);
    for (const r of dfRows ?? []) dfMap.set(r.deliverable_file_id, r);
  }

  // Collapse to distinct DELIVERABLES (not file-analyses) so multiple versions
  // of the same filing don't repeat, and exclude the matter being drafted —
  // exemplars are cross-matter precedent; feeding this matter's own work back
  // under a "do not copy matter-specific facts" instruction invites leakage.
  const bestByDeliverable = new Map<string, PriorWorkSource>();
  for (const a of analyses) {
    const hit = bestByAnalysis.get(String(a.id));
    const df = a.deliverable_file_id ? dfMap.get(a.deliverable_file_id) : null;
    if (!hit || !df) continue;
    if (df.matter_id === matterId) continue;
    const existing = bestByDeliverable.get(df.deliverable_id);
    if (!existing || hit.similarity > existing.similarity) {
      bestByDeliverable.set(df.deliverable_id, {
        deliverableId: df.deliverable_id,
        title: df.deliverable_name ?? 'Prior filing',
        matterName: df.matter_name ?? '',
        excerpt: hit.excerpt,
        similarity: hit.similarity,
        analysisId: Number(a.id),
      });
    }
  }

  return [...bestByDeliverable.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

function buildPromptBlock(
  briefBlock: string,
  ownWork: MatterRecordSource[],
  priorWork: PriorWorkSource[],
  kbPages: KbSearchHit[],
  authorities: AuthoritySource[],
  closestExemplar: { title: string; matterName: string; text: string | null } | null,
  styleProfile: { documentType: string; profileMd: string } | null,
): string {
  const sections: string[] = [];

  if (briefBlock) {
    sections.push(`MATTER BRIEF (the facts and posture to draft from):\n${briefBlock}`);
  }

  if (styleProfile) {
    sections.push(
      `FIRM HOUSE STYLE FOR A "${styleProfile.documentType}" (distilled from the firm's own finalized filings — FOLLOW these conventions for structure, tone, prayer, citations, and phrasing):\n${styleProfile.profileMd}`,
    );
  }

  if (closestExemplar?.text) {
    sections.push(
      `CLOSEST FIRM EXEMPLAR — "${closestExemplar.title}"${closestExemplar.matterName ? ` (${closestExemplar.matterName})` : ''}. ` +
        `This is the firm's own most-similar filing, shown in full so you can MIRROR ITS STRUCTURE: the section order and headings, how arguments are framed and sequenced, the prayer, and the house phrasing/register. ` +
        `Match this quality and shape. Do NOT copy its matter-specific facts, party names, figures, or citations — take those from the matter brief and record:\n\n${closestExemplar.text}`,
    );
  }

  if (ownWork.length > 0) {
    sections.push(
      `THIS MATTER'S OWN RECORD (filings and documents already in THIS case — these are the same matter, so rely on their facts and stay consistent with the positions already taken here):\n` +
        ownWork
          .map((w, i) => `[${i + 1}] ${w.title}${w.origin ? ` (${w.origin})` : ''}:\n${w.excerpt}`)
          .join('\n\n'),
    );
  }

  if (kbPages.length > 0) {
    sections.push(
      `FIRM KNOWLEDGE (our own doctrine and practice notes — apply these):\n` +
        kbPages.map((p) => `- ${p.title}: ${p.summary || p.snippet}`).join('\n'),
    );
  }

  if (authorities.length > 0) {
    sections.push(
      `SUPREME COURT AUTHORITIES (on-point decisions from juris.ph, matched to this document and the matter's claims — summaries are AI-generated from lawphil text). ` +
        `Cite an authority ONLY where it genuinely supports the argument, using its exact case number and title as given here. ` +
        `NEVER cite a case that is not in this list or in the matter's own record — do not invent authorities. ` +
        `Every citation will be verified by a lawyer against the full decision before filing:\n` +
        authorities
          .map((a, i) => `[${i + 1}] ${a.caseNumber} — ${a.title}${a.date ? ` (${a.date})` : ''}${a.snippet ? `:\n${a.snippet}` : ''}`)
          .join('\n\n'),
    );
  }

  if (priorWork.length > 0) {
    sections.push(
      `EXEMPLARS FROM OTHER MATTERS (reuse the firm's structure and language where apt — do NOT copy these other matters' specific facts, names, or figures):\n` +
        priorWork
          .map((w, i) => `[${i + 1}] ${w.title}${w.matterName ? ` (${w.matterName})` : ''}:\n${w.excerpt}`)
          .join('\n\n'),
    );
  }

  return sections.join('\n\n');
}

function summarizeJson(value: unknown): string {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          return String(o.claim ?? o.title ?? o.description ?? o.name ?? o.ruling ?? JSON.stringify(o));
        }
        return String(v);
      })
      .filter(Boolean)
      .join('; ')
      .slice(0, 600);
  }
  return String(value).slice(0, 600);
}
