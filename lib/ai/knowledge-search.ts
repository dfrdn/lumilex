// ── Knowledge Search ────────────────────────────────────────────────
// Faceted search over the firm's corpus: literal ("exact") matches first,
// then semantic ones.
//
// 1. semantic search via lib/ai/embeddings.ts → searchEmbeddings, and beside
//    it a keyword pass (full text over analysed documents, names of files,
//    deliverables and matters)
// 2. dedup chunks by (source_type, source_id), keep max-similarity; an exact
//    hit displaces the semantic hit for the same source
// 3. batch-enrich source_ids in parallel — one .in() per source_type
// 4. derive a user-friendly category from (source_type, metadata.deliverableType)
// 5. snippet: regex-highlight query terms, center 250-char window
// 6. narrow to what the viewer may open, then group by category for the UI

import { searchEmbeddings, type EmbeddingMatch } from '@/lib/ai/embeddings';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { filterVisible, resolveAccessScope } from '@/lib/ai/knowledge-access';
import { isKeywordEligible, mergeExactFirst, stripHeadlineMarkers } from '@/lib/ai/knowledge-merge';
import { normalizeDocumentType } from '@/lib/document-type';
import { sourceLabel } from '@/lib/rules/model';
import type { RuleSource } from '@/lib/rules/parse-rules-of-court';

// ── Types ────────────────────────────────────────────────────────────

export type KnowledgeCategory =
  | 'Exact matches'
  | 'Library'
  | 'Rules of Court'
  | 'Pleadings'
  | 'Memos'
  | 'Matter Briefs'
  | 'Hearings'
  | 'Meetings'
  | 'Files'
  | 'Client Letters'
  | 'Status Reports'
  | 'Deliverables';

export const CATEGORY_ORDER: KnowledgeCategory[] = [
  'Exact matches',
  'Library',
  'Rules of Court',
  'Matter Briefs',
  'Pleadings',
  'Memos',
  'Client Letters',
  'Status Reports',
  'Hearings',
  'Meetings',
  'Files',
  'Deliverables',
];

export interface EnrichedResult {
  sourceType: string;
  sourceId: string;
  displayLabel: string;
  deepLinkHref: string | null;
  matterId: string | null;
  matterName: string | null;
  snippet: string;
  highlighted: boolean;
  similarity: number;
  chunkMatchCount: number;
  category: KnowledgeCategory;
  /** True when the document contains the query terms literally (keyword hit). */
  exact: boolean;
  /** Controlled-vocabulary document type from the file analysis, when known. */
  documentType: string | null;
}

export interface KnowledgeResults {
  groups: Partial<Record<KnowledgeCategory, { count: number; results: EnrichedResult[] }>>;
  totalResults: number;
  topSimilarity: number | null;
}

// ── Source label / URL helpers ───────────────────────────────────────

/**
 * Human-readable label for a search result row. Shared between
 * matter-chat (which feeds it into the LLM context) and knowledge-search
 * (which renders it as the primary line in the UI).
 */
export function formatSourceLabel(
  sourceType: string,
  meta: Record<string, string>,
): string {
  const name = meta.fileName || meta.deliverableName || meta.name || meta.title || meta.matterName || 'Unknown';
  switch (sourceType) {
    case 'file_analysis':
      return `Document: ${name}`;
    case 'deliverable_version': {
      const dName = meta.deliverableName || name;
      const v = meta.version ? ` v${meta.version}` : '';
      return `Our Filing: ${dName}${v}`;
    }
    case 'matter_summary':
      return `Matter Summary: ${name}`;
    case 'matter':
      return `Matter: ${name}`;
    case 'deliverable':
      return `Deliverable: ${name}`;
    case 'hearing':
      return `Hearing: ${name}`;
    case 'filing':
      return `Filing: ${name}`;
    case 'file':
      return `File: ${name}`;
    case 'email_attachment':
      return `Email Document: ${name}`;
    case 'meeting':
      return `Meeting: ${name}`;
    case 'kb_page':
      return `Library: ${name}`;
    case 'court_rule':
      return `Rules of Court: ${name}`;
    default:
      return name;
  }
}

/**
 * Deep link to the source detail page. enriched should contain whichever
 * id is needed to reach the entity (file_id for file_analysis, deliverable_id
 * for deliverable_version, etc.).
 */
export function formatSourceUrl(
  sourceType: string,
  enriched: { entityId?: string | null; matterId?: string | null },
): string | null {
  const id = enriched.entityId;
  if (!id) return null;
  switch (sourceType) {
    case 'file_analysis':
    case 'file':
      return `/dashboard/files/${id}`;
    case 'deliverable_version':
    case 'deliverable':
      return `/dashboard/deliverables/${id}`;
    case 'matter_summary':
    case 'matter':
      return `/dashboard/matters/${id}`;
    case 'hearing':
      return `/dashboard/hearings/${id}`;
    case 'filing':
      return `/dashboard/deliverables/${id}`;
    case 'meeting':
      return `/dashboard/meetings/${id}`;
    case 'kb_page':
    case 'court_rule':
      // A section's entityId carries its page and "?section=N" (see the lookup).
      return `/dashboard/library/${id}`;
    case 'email_attachment':
      // entityId is the linked matter — emails render on the matter detail page.
      return `/dashboard/matters/${id}#emails`;
    default:
      return null;
  }
}

// ── Category derivation ──────────────────────────────────────────────

function deriveCategory(
  sourceType: string,
  metadata: Record<string, unknown>,
  enrichedDeliverableType?: string | null,
): KnowledgeCategory {
  const deliverableType = String(metadata.deliverableType ?? enrichedDeliverableType ?? '').trim();
  switch (sourceType) {
    case 'deliverable_version':
      if (deliverableType === 'External') return 'Pleadings';
      if (deliverableType === 'Internal') return 'Memos';
      if (deliverableType === 'For Client') return 'Client Letters';
      if (deliverableType === 'Status Report') return 'Status Reports';
      return 'Deliverables';
    case 'deliverable':
      if (deliverableType === 'External') return 'Pleadings';
      if (deliverableType === 'Internal') return 'Memos';
      if (deliverableType === 'For Client') return 'Client Letters';
      if (deliverableType === 'Status Report') return 'Status Reports';
      return 'Deliverables';
    case 'filing':
      return 'Pleadings';
    case 'matter_summary':
    case 'matter':
      return 'Matter Briefs';
    case 'hearing':
      return 'Hearings';
    case 'meeting':
      return 'Meetings';
    case 'kb_page':
      return 'Library';
    case 'court_rule':
      return 'Rules of Court';
    case 'file_analysis':
    case 'file':
    case 'email_attachment':
    default:
      return 'Files';
  }
}

// ── Snippet generation ───────────────────────────────────────────────

const STOP_TOKENS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'is', 'are',
  'was', 'were', 'be', 'by', 'for', 'with', 'as', 'this', 'that', 'these',
  'those', 'it', 'its', 'we', 'our', 'us', 'their', 'they', 'i', 'you',
]);

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
}

/**
 * Centered 250-char snippet around the first query-term hit in the chunk.
 * If no hit (purely semantic match with no surface overlap), returns the
 * first 250 chars. `highlighted` tells the UI whether to wrap matched
 * substrings in <mark>.
 */
function makeSnippet(
  chunkText: string,
  query: string,
): { snippet: string; highlighted: boolean } {
  const collapsed = chunkText.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 250) return { snippet: collapsed, highlighted: hasAnyQueryHit(collapsed, query) };

  const tokens = tokenizeQuery(query);
  const lower = collapsed.toLowerCase();
  let firstHit = -1;
  for (const t of tokens) {
    const idx = lower.indexOf(t);
    if (idx !== -1 && (firstHit === -1 || idx < firstHit)) firstHit = idx;
  }

  if (firstHit === -1) {
    return { snippet: collapsed.slice(0, 250) + '…', highlighted: false };
  }

  // Center 250-char window on firstHit, snap to nearest word boundaries.
  const start = Math.max(0, firstHit - 100);
  const end = Math.min(collapsed.length, start + 250);
  const adjustedStart = start > 0
    ? Math.max(start, collapsed.lastIndexOf(' ', start) + 1)
    : 0;
  const adjustedEnd = end < collapsed.length
    ? Math.min(end, collapsed.indexOf(' ', end) === -1 ? end : collapsed.indexOf(' ', end))
    : end;

  const prefix = adjustedStart > 0 ? '…' : '';
  const suffix = adjustedEnd < collapsed.length ? '…' : '';
  return {
    snippet: prefix + collapsed.slice(adjustedStart, adjustedEnd) + suffix,
    highlighted: true,
  };
}

function hasAnyQueryHit(text: string, query: string): boolean {
  const tokens = tokenizeQuery(query);
  const lower = text.toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

/**
 * Wrap query-term occurrences in <mark>. Caller decides whether to render
 * the returned HTML (only when snippet.highlighted === true to avoid
 * pointless DOM work). Tokens shorter than 3 chars and stop words are
 * skipped to keep noise down.
 */
export function highlightQueryTerms(text: string, query: string): string {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return escapeHtml(text);
  const pattern = new RegExp(
    '(' + tokens.map(escapeRegex).join('|') + ')',
    'gi',
  );
  return escapeHtml(text).replace(pattern, '<mark class="bg-gold-100 dark:bg-gold-400/20 text-inherit rounded-sm px-0.5 font-semibold">$1</mark>');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Batch enrichment ─────────────────────────────────────────────────

interface DedupedMatch {
  match: EmbeddingMatch;
  chunkMatchCount: number;
}

/**
 * Dedup by (source_type, source_id), keep max-similarity chunk, count
 * how many chunks matched.
 */
function dedupMatches(matches: EmbeddingMatch[]): DedupedMatch[] {
  const map = new Map<string, DedupedMatch>();
  for (const m of matches) {
    const key = `${m.source_type}::${m.source_id}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { match: m, chunkMatchCount: 1 });
    } else {
      existing.chunkMatchCount += 1;
      if (m.similarity > existing.match.similarity) existing.match = m;
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.match.similarity - a.match.similarity,
  );
}

interface EnrichmentLookup {
  // source_type:source_id -> { entityId for URL, display name, matterName, deliverableType }
  entityId: string | null;
  displayName: string | null;
  matterName: string | null;
  matterId: string | null;
  deliverableType: string | null;
  documentType?: string | null;
}

async function batchEnrich(
  deduped: DedupedMatch[],
  firmId: string,
): Promise<Map<string, EnrichmentLookup>> {
  const supabase = getServiceDbForFirm(firmId);
  const lookup = new Map<string, EnrichmentLookup>();

  // Group source_ids by source_type
  const idsByType: Record<string, string[]> = {};
  for (const { match } of deduped) {
    if (!idsByType[match.source_type]) idsByType[match.source_type] = [];
    idsByType[match.source_type].push(String(match.source_id));
  }

  await Promise.all(
    Object.entries(idsByType).map(async ([sourceType, ids]) => {
      if (ids.length === 0) return;

      switch (sourceType) {
        case 'file_analysis': {
          const { data } = await supabase
            .from('file_analyses')
            .select('id, file_id, attachment_name, deliverable_file_id, document_type:entities->>documentType')
            .in('id', ids.map((s) => Number(s)).filter((n) => !Number.isNaN(n)));
          if (!data) return;
          // Need matter_id + matter_name via files for proper enrichment.
          const fileIds = data.map((r) => r.file_id).filter(Boolean) as string[];
          const fileMap = new Map<string, { matter_id: string | null; matter_name: string | null; name: string }>();
          if (fileIds.length > 0) {
            const { data: filesData } = await supabase
              .from('files')
              .select('notion_id, matter_id, matter_name, name')
              .in('notion_id', fileIds);
            for (const f of filesData ?? []) {
              fileMap.set(f.notion_id, { matter_id: f.matter_id, matter_name: f.matter_name, name: f.name });
            }
          }
          for (const r of data) {
            const file = r.file_id ? fileMap.get(r.file_id) : null;
            lookup.set(`${sourceType}::${r.id}`, {
              entityId: r.file_id ?? null,
              displayName: r.attachment_name ?? file?.name ?? null,
              matterName: file?.matter_name ?? null,
              matterId: file?.matter_id ?? null,
              deliverableType: null,
              documentType: normalizeDocumentType((r as { document_type?: string | null }).document_type),
            });
          }
          break;
        }
        case 'deliverable_version': {
          // analysis id (file_analyses.id) is the source_id for these,
          // but to deep-link we want the parent deliverable. Use the
          // v_deliverable_version_lookup view by joining through
          // file_analyses → deliverable_file_id → view.
          const analysisIds = ids.map((s) => Number(s)).filter((n) => !Number.isNaN(n));
          if (analysisIds.length === 0) break;
          const { data: analyses } = await supabase
            .from('file_analyses')
            .select('id, deliverable_file_id, attachment_name')
            .in('id', analysisIds);
          if (!analyses) break;
          const dfIds = analyses.map((a) => a.deliverable_file_id).filter((x): x is number => x != null);
          const dfMap = new Map<number, { deliverable_id: string; deliverable_name: string | null; matter_id: string | null; matter_name: string | null; deliverable_type: string | null }>();
          if (dfIds.length > 0) {
            const { data: dfRows } = await supabase
              .from('v_deliverable_version_lookup')
              .select('deliverable_file_id, deliverable_id, deliverable_name, matter_id, matter_name, deliverable_type')
              .in('deliverable_file_id', dfIds);
            for (const r of dfRows ?? []) {
              dfMap.set(r.deliverable_file_id, r);
            }
          }
          for (const a of analyses) {
            const df = a.deliverable_file_id ? dfMap.get(a.deliverable_file_id) : null;
            lookup.set(`${sourceType}::${a.id}`, {
              entityId: df?.deliverable_id ?? null,
              displayName: df?.deliverable_name ?? a.attachment_name ?? null,
              matterName: df?.matter_name ?? null,
              matterId: df?.matter_id ?? null,
              deliverableType: df?.deliverable_type ?? null,
            });
          }
          break;
        }
        case 'email_attachment': {
          // source_id is the file_analyses.id (same as deliverable_version).
          const analysisIds = ids.map((s) => Number(s)).filter((n) => !Number.isNaN(n));
          if (analysisIds.length === 0) break;
          const { data: analyses } = await supabase
            .from('file_analyses')
            .select('id, email_attachment_id, attachment_name')
            .in('id', analysisIds);
          if (!analyses) break;

          const attIds = analyses.map((a) => a.email_attachment_id).filter((x): x is number => x != null);
          const attMap = new Map<number, { email_id: number }>();
          if (attIds.length > 0) {
            const { data: attRows } = await supabase
              .from('email_attachments')
              .select('id, email_id')
              .in('id', attIds);
            for (const r of attRows ?? []) attMap.set(r.id, { email_id: r.email_id });
          }

          const emailIds = [...new Set([...attMap.values()].map((a) => a.email_id))];
          const emailMatter = new Map<number, string>();
          if (emailIds.length > 0) {
            const { data: linkRows } = await supabase
              .from('email_matter_links')
              .select('email_id, matter_id, confidence')
              .in('email_id', emailIds)
              .order('confidence', { ascending: false });
            for (const l of linkRows ?? []) {
              if (!emailMatter.has(l.email_id)) emailMatter.set(l.email_id, l.matter_id);
            }
          }

          const matterIds = [...new Set([...emailMatter.values()])];
          const matterNames = new Map<string, string>();
          if (matterIds.length > 0) {
            const { data: matterRows } = await supabase
              .from('matters')
              .select('notion_id, name')
              .in('notion_id', matterIds);
            for (const m of matterRows ?? []) matterNames.set(m.notion_id, m.name);
          }

          for (const a of analyses) {
            const att = a.email_attachment_id ? attMap.get(a.email_attachment_id) : null;
            const matterId = att ? emailMatter.get(att.email_id) ?? null : null;
            lookup.set(`${sourceType}::${a.id}`, {
              entityId: matterId,
              displayName: a.attachment_name ?? null,
              matterName: matterId ? matterNames.get(matterId) ?? null : null,
              matterId,
              deliverableType: null,
            });
          }
          break;
        }
        case 'matter':
        case 'matter_summary': {
          const { data } = await supabase
            .from('matters')
            .select('notion_id, name, matter_code, client_name')
            .in('notion_id', ids);
          for (const m of data ?? []) {
            lookup.set(`${sourceType}::${m.notion_id}`, {
              entityId: m.notion_id,
              displayName: m.name,
              matterName: m.name,
              matterId: m.notion_id,
              deliverableType: null,
            });
          }
          break;
        }
        case 'hearing': {
          const { data } = await supabase
            .from('hearings')
            .select('notion_id, name, matter_id, matter_name')
            .in('notion_id', ids);
          for (const h of data ?? []) {
            lookup.set(`${sourceType}::${h.notion_id}`, {
              entityId: h.notion_id,
              displayName: h.name,
              matterName: h.matter_name,
              matterId: h.matter_id,
              deliverableType: null,
            });
          }
          break;
        }
        case 'meeting': {
          const { data } = await supabase
            .from('meetings')
            .select('notion_id, name, matter_id, matter_name')
            .in('notion_id', ids);
          for (const m of data ?? []) {
            lookup.set(`${sourceType}::${m.notion_id}`, {
              entityId: m.notion_id,
              displayName: m.name,
              matterName: m.matter_name,
              matterId: m.matter_id,
              deliverableType: null,
            });
          }
          break;
        }
        case 'file': {
          const { data } = await supabase
            .from('files')
            .select('notion_id, name, matter_id, matter_name')
            .in('notion_id', ids);
          for (const f of data ?? []) {
            lookup.set(`${sourceType}::${f.notion_id}`, {
              entityId: f.notion_id,
              displayName: f.name,
              matterName: f.matter_name,
              matterId: f.matter_id,
              deliverableType: null,
            });
          }
          break;
        }
        case 'deliverable': {
          const { data } = await supabase
            .from('deliverables')
            .select('notion_id, name, matter_id, matter_name, type')
            .in('notion_id', ids);
          for (const d of data ?? []) {
            lookup.set(`${sourceType}::${d.notion_id}`, {
              entityId: d.notion_id,
              displayName: d.name,
              matterName: d.matter_name,
              matterId: d.matter_id,
              deliverableType: d.type,
            });
          }
          break;
        }
        case 'filing': {
          // A filing is an external deliverable with a due date.
          const { data } = await supabase
            .from('deliverables')
            .select('notion_id, name, matter_id, matter_name')
            .eq('type', 'External')
            .not('external_due_date', 'is', null)
            .in('notion_id', ids);
          for (const f of data ?? []) {
            lookup.set(`${sourceType}::${f.notion_id}`, {
              entityId: f.notion_id,
              displayName: f.name,
              matterName: f.matter_name,
              matterId: f.matter_id,
              deliverableType: null,
            });
          }
          break;
        }
        case 'kb_page': {
          const { data } = await supabase
            .from('kb_pages')
            .select('id, title, kind')
            .in('id', ids.map((s) => Number(s)).filter((n) => !Number.isNaN(n)));
          for (const p of data ?? []) {
            lookup.set(`${sourceType}::${p.id}`, {
              entityId: String(p.id),
              displayName: p.title,
              matterName: null,
              matterId: null,
              deliverableType: null,
            });
          }
          break;
        }
        case 'court_rule': {
          const { data } = await supabase
            .from('court_rule_sections')
            .select('id, source, section, citation, title, kb_page_id')
            .in('id', ids.map((s) => Number(s)).filter((n) => !Number.isNaN(n)));
          for (const r of data ?? []) {
            lookup.set(`${sourceType}::${r.id}`, {
              entityId: r.kb_page_id ? `${r.kb_page_id}?section=${r.section}` : null,
              displayName: `${r.citation} — ${r.title} (${sourceLabel(r.source as RuleSource)})`,
              matterName: null,
              matterId: null,
              deliverableType: null,
            });
          }
          break;
        }
        default:
          // Unknown source_type — leave unenriched; result still renders
          // with the metadata-derived label.
          break;
      }
    }),
  );

  return lookup;
}

// ── Keyword ("exact") hits ───────────────────────────────────────────

type Candidate = DedupedMatch & { key: string; exact: boolean };

function toCandidate(d: DedupedMatch, exact: boolean): Candidate {
  return { ...d, key: `${d.match.source_type}::${d.match.source_id}`, exact };
}

interface TextHitRow {
  analysis_id: number;
  file_id: string | null;
  deliverable_file_id: number | null;
  attachment_name: string | null;
  rank: number;
  headline: string | null;
}

/**
 * Literal matches: full-text over document text, plus name matches on
 * files, deliverables, and matters (party names, docket numbers, titles).
 * Skipped for long machine queries. Returned in the same shape as semantic
 * matches so enrichment and access scoping treat them identically. Nothing
 * here leaves the firm's database, so unlike the semantic pass it does not
 * wait on `ai_search`.
 */
async function keywordMatches(query: string, limit: number, firmId: string): Promise<Candidate[]> {
  if (!isKeywordEligible(query)) return [];
  const supabase = getServiceDbForFirm(firmId);
  const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  // An or() filter is parsed by PostgREST, so its value cannot carry the
  // delimiters itself.
  const orLike = like.replace(/[,()"]/g, ' ');

  const [text, rules, files, deliverables, matters] = await Promise.all([
    supabase.rpc('search_document_text', { p_firm_id: firmId, p_query: query, p_limit: limit }),
    supabase.rpc('search_court_rules', { p_firm_id: firmId, p_query: query, p_limit: 5 }),
    supabase.from('files').select('notion_id, name, matter_id').ilike('name', like).limit(8),
    supabase.from('deliverables').select('notion_id, name, matter_id').ilike('name', like).limit(8),
    supabase
      .from('matters')
      .select('notion_id, name, matter_code, client_name')
      .or(`name.ilike.${orLike},case_title.ilike.${orLike},client_name.ilike.${orLike},matter_code.ilike.${orLike}`)
      .limit(5),
  ]);
  if (text.error) console.error('[knowledge-search] keyword RPC failed:', text.error.message);
  if (rules.error) console.error('[knowledge-search] rules RPC failed:', rules.error.message);

  const out: Candidate[] = [];
  const synth = (source_type: string, source_id: string, matter_id: string | null, chunk_text: string) =>
    toCandidate(
      { match: { id: 0, source_type, source_id, matter_id, chunk_index: 0, chunk_text, metadata: {}, similarity: 1 }, chunkMatchCount: 1 },
      true,
    );

  for (const m of (matters.data ?? [])) {
    out.push(synth('matter', m.notion_id, m.notion_id, [m.matter_code, m.name, m.client_name].filter(Boolean).join(' · ')));
  }
  for (const r of ((text.data ?? []) as TextHitRow[])) {
    const source_type = r.file_id ? 'file_analysis' : 'deliverable_version';
    out.push(synth(source_type, String(r.analysis_id), null, stripHeadlineMarkers(r.headline ?? r.attachment_name ?? '')));
  }
  for (const r of ((rules.data ?? []) as { id: number; citation: string; title: string; headline: string | null }[])) {
    out.push(synth('court_rule', String(r.id), null, stripHeadlineMarkers(r.headline ?? `${r.citation}. ${r.title}`)));
  }
  for (const d of (deliverables.data ?? [])) out.push(synth('deliverable', d.notion_id, d.matter_id, d.name ?? ''));
  for (const f of (files.data ?? [])) out.push(synth('file', f.notion_id, f.matter_id, f.name ?? ''));
  return out;
}

// ── Public API ───────────────────────────────────────────────────────

export interface SearchOptions {
  firmId: string;
  matterId?: string | null;
  excludeMatterId?: string | null;
  category?: KnowledgeCategory;
  /** Controlled-vocabulary document type; results without a known type are hidden when set. */
  documentType?: string | null;
  limit?: number;
  threshold?: number;
  /**
   * The caller's RLS-scoped client. Results the caller could not open on the
   * site are dropped before ranking. Required, so a new caller has to decide
   * whose view it is searching with rather than getting the firm-wide corpus by
   * default.
   */
  viewer: SupabaseClient;
}

/**
 * Faceted search over the firm's corpus: exact matches, then semantic ones.
 * Returns results grouped by user-friendly category.
 */
export async function searchKnowledge(
  query: string,
  opts: SearchOptions,
): Promise<KnowledgeResults> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { groups: {}, totalResults: 0, topSimilarity: null };
  }

  // Fetch wider than the eventual display count to absorb dedup collapse.
  // Keyword hits run alongside; they lead the merged list.
  const [raw, exact] = await Promise.all([
    searchEmbeddings(trimmed, {
      matterId: opts.matterId ?? null,
      limit: opts.limit ? Math.max(opts.limit * 2, 40) : 80,
      threshold: opts.threshold ?? 0.3,
      firmId: opts.firmId,
    }),
    keywordMatches(trimmed, opts.limit ?? 10, opts.firmId).catch((err) => {
      console.error('[knowledge-search] keyword search failed:', err instanceof Error ? err.message : err);
      return [] as Candidate[];
    }),
  ]);

  if (raw.length === 0 && exact.length === 0) {
    return { groups: {}, totalResults: 0, topSimilarity: null };
  }

  // Optional client-side excludeMatterId filter (the RPC doesn't support
  // exclusion natively).
  const filtered = opts.excludeMatterId
    ? raw.filter((m) => m.matter_id !== opts.excludeMatterId)
    : raw;

  const deduped = mergeExactFirst(exact, dedupMatches(filtered).map((d) => toCandidate(d, false)));

  // Batch-enrich
  const lookup = await batchEnrich(deduped, opts.firmId);

  const candidates = deduped.map(({ match, chunkMatchCount, exact: isExact }) => {
    const meta = (match.metadata ?? {}) as Record<string, string>;
    const key = `${match.source_type}::${match.source_id}`;
    const lk = lookup.get(key);
    const category: KnowledgeCategory = isExact
      ? 'Exact matches'
      : deriveCategory(match.source_type, match.metadata ?? {}, lk?.deliverableType);
    const displayLabel = formatSourceLabel(match.source_type, {
      ...meta,
      // Prefer enriched name over metadata snapshot (metadata can be stale).
      fileName: lk?.displayName ?? meta.fileName ?? '',
      deliverableName: lk?.displayName ?? meta.deliverableName ?? '',
      matterName: lk?.matterName ?? meta.matterName ?? '',
    });
    const deepLinkHref = formatSourceUrl(match.source_type, {
      entityId: lk?.entityId ?? null,
      matterId: lk?.matterId ?? match.matter_id ?? null,
    });
    const made = makeSnippet(match.chunk_text, trimmed);
    const snippet = made.snippet;
    // A keyword hit's headline always contains the terms, even when the
    // token highlighter would miss a stemmed form.
    const highlighted = isExact || made.highlighted;
    const result: EnrichedResult = {
      sourceType: match.source_type,
      sourceId: String(match.source_id),
      displayLabel,
      deepLinkHref,
      matterId: lk?.matterId ?? match.matter_id ?? null,
      matterName: lk?.matterName ?? meta.matterName ?? null,
      snippet,
      highlighted,
      similarity: match.similarity,
      chunkMatchCount,
      category,
      exact: isExact,
      documentType: lk?.documentType ?? null,
    };
    return result;
  });

  // Narrow to what the viewer could open on the site. Keyword hits skipped
  // the RPC's matter scoping; apply it here now that the matter is known.
  // Then collapse entries that open the same page (a deliverable's DOCX and
  // PDF versions both match): the first, best-ranked one stays.
  const seenHref = new Set<string>();
  const enriched: EnrichedResult[] = filterVisible(
    candidates,
    await resolveAccessScope(opts.viewer, candidates),
  )
    .filter((r) => !r.exact || (
      (!opts.matterId || r.matterId === opts.matterId) &&
      (!opts.excludeMatterId || r.matterId !== opts.excludeMatterId)
    ))
    .filter((r) => {
      if (!r.deepLinkHref) return true;
      if (seenHref.has(r.deepLinkHref)) return false;
      seenHref.add(r.deepLinkHref);
      return true;
    });

  // Optional category and document-type filters
  const finalResults = enriched.filter((r) =>
    (!opts.category || r.category === opts.category) &&
    (!opts.documentType || r.documentType === opts.documentType),
  );

  // Group by category
  const groups: Partial<Record<KnowledgeCategory, { count: number; results: EnrichedResult[] }>> = {};
  for (const r of finalResults) {
    if (!groups[r.category]) groups[r.category] = { count: 0, results: [] };
    groups[r.category]!.count += 1;
    groups[r.category]!.results.push(r);
  }

  // Cap per-category to limit (default 10) to keep responses bounded.
  const perCategoryCap = opts.limit ?? 10;
  for (const cat of Object.keys(groups) as KnowledgeCategory[]) {
    groups[cat]!.results = groups[cat]!.results.slice(0, perCategoryCap);
  }

  return {
    groups,
    totalResults: finalResults.length,
    // An exact hit carries a synthetic similarity of 1; the top score means the semantic one.
    topSimilarity: enriched.find((r) => !r.exact)?.similarity ?? null,
  };
}
