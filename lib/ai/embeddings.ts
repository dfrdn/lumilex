// ── Embedding Orchestration ──────────────────────────────────────────
// Generates, stores, and searches vector embeddings via Voyage AI + pgvector

import { embedTexts, embedQuery, isVoyageConfigured } from '@/lib/ai/voyage';
import { requireAi } from '@/lib/ai/gate';
import { isFeatureAvailable } from '@/lib/firm/features';
import { chunkText } from '@/lib/ai/chunker';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type { AnalysisEntities } from '@/types/ai';

/**
 * The match_embeddings* RPCs rank the whole pool — they have no firm filter
 * yet. Until the SQL functions learn one, drop any match whose embeddings row
 * is not visible through the firm-scoped client (one indexed .in() probe).
 */
async function filterMatchesToFirm(
  matches: EmbeddingMatch[],
  firmId: string,
): Promise<EmbeddingMatch[]> {
  if (matches.length === 0) return matches;
  const { data } = await getServiceDbForFirm(firmId)
    .from('embeddings')
    .select('id')
    .in('id', matches.map((m) => m.id));
  const visible = new Set((data ?? []).map((r: { id: number }) => r.id));
  return matches.filter((m) => visible.has(m.id));
}

// ── Entity flattening ────────────────────────────────────────────────
//
// The Claude analyzer extracts rich structured entities (parties, dates,
// deadlines, obligations, caseReferences, documentType, jurisdiction) that are
// rendered in the UI but historically never made it into the vector store.
// Flatten them into a plain-text block that travels with the summary so
// questions like "what are the deadlines?" / "who are the parties?" match
// directly on the facts instead of relying on them being restated in prose.

function formatEntitiesForEmbedding(entities: unknown): string {
  if (!entities || typeof entities !== 'object') return '';
  const e = entities as Partial<AnalysisEntities>;
  const lines: string[] = [];

  if (e.documentType?.trim()) lines.push(`DOCUMENT TYPE: ${e.documentType.trim()}`);
  if (e.jurisdiction?.trim()) lines.push(`JURISDICTION: ${e.jurisdiction.trim()}`);

  if (Array.isArray(e.parties) && e.parties.length) {
    const s = e.parties
      .filter((p) => p && (p.name || p.role))
      .map((p) => (p.role ? `${p.name} (${p.role})` : p.name))
      .join('; ');
    if (s) lines.push(`PARTIES: ${s}`);
  }

  if (Array.isArray(e.dates) && e.dates.length) {
    const s = e.dates
      .filter((d) => d && (d.date || d.description))
      .map((d) => [d.date, d.description].filter(Boolean).join(' — '))
      .join('; ');
    if (s) lines.push(`KEY DATES: ${s}`);
  }

  if (Array.isArray(e.deadlines) && e.deadlines.length) {
    const s = e.deadlines
      .filter((d) => d && (d.date || d.description))
      .map((d) => [d.date, d.description].filter(Boolean).join(' — '))
      .join('; ');
    if (s) lines.push(`DEADLINES: ${s}`);
  }

  if (Array.isArray(e.obligations) && e.obligations.length) {
    const s = e.obligations
      .filter((o) => o && (o.party || o.description))
      .map((o) => [o.party, o.description].filter(Boolean).join(': '))
      .join('; ');
    if (s) lines.push(`OBLIGATIONS: ${s}`);
  }

  if (Array.isArray(e.caseReferences) && e.caseReferences.length) {
    const refs = e.caseReferences.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
    if (refs.length) lines.push(`CASE REFERENCES: ${refs.join('; ')}`);
  }

  return lines.join('\n');
}

// ── Types ────────────────────────────────────────────────────────────

export type SourceType =
  | 'file_analysis'
  | 'deliverable_version'
  | 'email_attachment'
  | 'matter_summary'
  | 'matter'
  | 'deliverable'
  | 'hearing'
  | 'filing'
  | 'file'
  | 'meeting'
  | 'kb_page'
  | 'court_rule'
  | 'affidavit_note'
  | 'red_team_note';

export interface EmbeddingMatch {
  id: number;
  source_type: string;
  source_id: string;
  matter_id: string | null;
  chunk_index: number;
  chunk_text: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

// ── Core Functions ───────────────────────────────────────────────────

/**
 * Generate embeddings for a completed file analysis. Works for all sources:
 *   - incoming file analyses (file_id set)       → source_type = 'file_analysis'
 *   - deliverable version analyses (deliverable_file_id set) → source_type = 'deliverable_version'
 *   - email attachment analyses (email_attachment_id set) → source_type = 'email_attachment'
 * Chunks the extracted_text + summary, embeds, and upserts.
 */
export async function generateEmbeddingsForFileAnalysis(
  analysisId: number,
  firmId: string,
): Promise<number> {
  if (!isVoyageConfigured()) return 0;

  const supabase = getServiceDbForFirm(firmId);

  const { data: analysis, error } = await supabase
    .from('file_analyses')
    .select('id, file_id, deliverable_file_id, email_attachment_id, extracted_text, summary, short_summary, entities, attachment_name')
    .eq('id', analysisId)
    .single();

  if (error || !analysis) {
    console.error(`[embeddings] Analysis ${analysisId} not found:`, error?.message);
    return 0;
  }

  // Resolve source_type, matter_id, and source-specific metadata.
  let sourceType: SourceType = 'file_analysis';
  let matterId: string | null = null;
  let metadata: Record<string, string | number> = {
    fileName: analysis.attachment_name,
    shortSummary: analysis.short_summary || '',
  };

  if (analysis.file_id) {
    const { data: fileRecord } = await supabase
      .from('files')
      .select('matter_id, matter_name, origin')
      .eq('notion_id', analysis.file_id)
      .single();
    matterId = fileRecord?.matter_id || null;
    metadata = {
      ...metadata,
      matterName: fileRecord?.matter_name || '',
      origin: fileRecord?.origin || '',
    };
  } else if (analysis.deliverable_file_id) {
    sourceType = 'deliverable_version';
    const { data: dfRow } = await supabase
      .from('deliverable_files')
      .select('id, deliverable_id, version, file_name, action')
      .eq('id', analysis.deliverable_file_id)
      .single();

    if (dfRow?.deliverable_id) {
      const { data: deliverable } = await supabase
        .from('deliverables')
        .select('notion_id, name, type, matter_id, matter_name, status')
        .eq('notion_id', dfRow.deliverable_id)
        .single();
      matterId = deliverable?.matter_id || null;
      metadata = {
        ...metadata,
        matterName: deliverable?.matter_name || '',
        deliverableName: deliverable?.name || '',
        deliverableType: deliverable?.type || '',
        deliverableStatus: deliverable?.status || '',
        version: dfRow.version ?? 0,
        action: dfRow.action || '',
        origin: 'Outgoing',
      };
    }
  } else if (analysis.email_attachment_id) {
    sourceType = 'email_attachment';
    const { data: attRow } = await supabase
      .from('email_attachments')
      .select('id, email_id, file_name')
      .eq('id', analysis.email_attachment_id)
      .single();

    if (attRow?.email_id) {
      const { data: emailRow } = await supabase
        .from('emails')
        .select('id, subject, from_name, from_address, received_at')
        .eq('id', attRow.email_id)
        .single();

      const { data: linkRows } = await supabase
        .from('email_matter_links')
        .select('matter_id, confidence')
        .eq('email_id', attRow.email_id)
        .order('confidence', { ascending: false })
        .limit(1);

      matterId = linkRows?.[0]?.matter_id || null;

      let matterName = '';
      if (matterId) {
        const { data: matterRow } = await supabase
          .from('matters')
          .select('name')
          .eq('notion_id', matterId)
          .single();
        matterName = matterRow?.name || '';
      }

      metadata = {
        ...metadata,
        matterName,
        emailId: attRow.email_id,
        emailSubject: emailRow?.subject || '',
        emailFrom: emailRow?.from_name || emailRow?.from_address || '',
        receivedAt: emailRow?.received_at || '',
        origin: 'Incoming (Email)',
      };
    }
  }

  // Build text to embed:
  //   1. extracted text (primary — the raw document)
  //   2. summary (secondary — narrative Claude wrote)
  //   3. flattened entities (tertiary — structured facts: parties, dates,
  //      deadlines, obligations, case refs, doc type, jurisdiction).
  //      Prepend a short header naming the source so retrieval can cite it.
  const textsToEmbed: string[] = [];
  if (analysis.extracted_text) textsToEmbed.push(analysis.extracted_text);
  if (analysis.summary) textsToEmbed.push(analysis.summary);

  const entitiesBlock = formatEntitiesForEmbedding(analysis.entities);
  if (entitiesBlock) {
    const header = metadata.deliverableName
      ? `Structured facts extracted from "${metadata.deliverableName}" v${metadata.version ?? ''} (${analysis.attachment_name}):`
      : `Structured facts extracted from ${analysis.attachment_name}:`;
    textsToEmbed.push(`${header}\n${entitiesBlock}`);
  }

  if (textsToEmbed.length === 0) return 0;

  const chunks = chunkText(textsToEmbed.join('\n\n---\n\n'));
  if (chunks.length === 0) return 0;

  return upsertEmbeddings(
    sourceType,
    String(analysis.id),
    matterId,
    chunks,
    metadata,
    firmId,
  );
}

/**
 * Generate embeddings for a matter summary.
 */
export async function generateEmbeddingsForMatterSummary(
  matterId: string,
  firmId: string,
): Promise<number> {
  if (!isVoyageConfigured()) return 0;

  const supabase = getServiceDbForFirm(firmId);

  const { data: summary } = await supabase
    .from('matter_summaries')
    .select('summary, latest_incident, posture, court_and_venue, parties, claims_and_defenses, key_rulings, key_dates, open_issues')
    .eq('matter_id', matterId)
    .single();

  if (!summary?.summary) return 0;

  const { data: matter } = await supabase
    .from('matters')
    .select('name, matter_code, client_name, type, is_case')
    .eq('notion_id', matterId)
    .single();

  // Flatten the structured brief into a single text blob so cross-matter
  // semantic search can match on posture, parties, rulings, etc., not just
  // the narrative summary.
  const sections: string[] = [summary.summary];
  if (summary.latest_incident) sections.push(`Latest incident: ${summary.latest_incident}`);
  if (summary.posture) sections.push(`Posture: ${summary.posture}`);
  if (summary.court_and_venue) sections.push(`Court and venue: ${summary.court_and_venue}`);

  const parties = Array.isArray(summary.parties) ? summary.parties as Array<{ name?: string; role?: string; side?: string }> : [];
  if (parties.length) {
    const s = parties.map((p) => `${p.name ?? ''} (${p.role ?? ''}${p.side ? `; ${p.side}` : ''})`).join('; ');
    sections.push(`Parties: ${s}`);
  }

  const claims = Array.isArray(summary.claims_and_defenses) ? summary.claims_and_defenses as Array<{ party?: string; theory?: string }> : [];
  if (claims.length) {
    const s = claims.map((c) => `${c.party ?? ''}: ${c.theory ?? ''}`).join('; ');
    sections.push(`Claims and defenses: ${s}`);
  }

  const rulings = Array.isArray(summary.key_rulings) ? summary.key_rulings as Array<{ date?: string; ruling?: string; effect?: string }> : [];
  if (rulings.length) {
    const s = rulings.map((r) => `${r.date ?? ''} — ${r.ruling ?? ''} (${r.effect ?? ''})`).join('; ');
    sections.push(`Key rulings: ${s}`);
  }

  const dates = Array.isArray(summary.key_dates) ? summary.key_dates as Array<{ date?: string; label?: string; status?: string }> : [];
  if (dates.length) {
    const s = dates.map((d) => `${d.date ?? ''} — ${d.label ?? ''}${d.status ? ` [${d.status}]` : ''}`).join('; ');
    sections.push(`Key dates: ${s}`);
  }

  const issues = Array.isArray(summary.open_issues) ? summary.open_issues as Array<{ issue?: string }> : [];
  if (issues.length) {
    const s = issues.map((i) => i.issue ?? '').filter(Boolean).join('; ');
    if (s) sections.push(`Open issues: ${s}`);
  }

  const chunks = chunkText(sections.join('\n\n'));
  if (chunks.length === 0) return 0;

  return upsertEmbeddings('matter_summary', matterId, matterId, chunks, {
    matterName: matter?.name || '',
    matterCode: matter?.matter_code || '',
    clientName: matter?.client_name || '',
    type: matter?.type || '',
    isCase: matter?.is_case ? 1 : 0,
  }, firmId);
}

/**
 * Generate a single-chunk embedding for a structured entity.
 * Used for deliverables, hearings, filings, files, meetings, matters.
 */
export async function generateEmbeddingsForEntity(
  sourceType: SourceType,
  sourceId: string,
  matterId: string | null,
  text: string,
  metadata: Record<string, unknown>,
  firmId: string,
): Promise<number> {
  if (!isVoyageConfigured()) return 0;
  if (!text.trim()) return 0;

  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;

  return upsertEmbeddings(sourceType, sourceId, matterId, chunks, metadata, firmId);
}

/**
 * Delete all embeddings for a given source.
 */
export async function deleteEmbeddingsForSource(
  sourceType: SourceType,
  sourceId: string,
  firmId: string,
): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);
  await supabase
    .from('embeddings')
    .delete()
    .eq('source_type', sourceType)
    .eq('source_id', sourceId);
}

// ── Search ───────────────────────────────────────────────────────────

/**
 * Semantic search across embeddings using vector similarity.
 */
export async function searchEmbeddings(
  query: string,
  opts: {
    firmId: string;
    matterId?: string | null;
    limit?: number;
    threshold?: number;
  },
): Promise<EmbeddingMatch[]> {
  // `ai_search` gates the read as well as the write: the query string is
  // itself firm content, and embedding it sends it to Voyage. Empty rather
  // than a throw — a firm that has not opted in has no vectors either, so []
  // is the true answer, and a background retrieval on a page must not 500.
  if (!(await isFeatureAvailable(opts.firmId, 'ai_search'))) return [];

  if (!isVoyageConfigured()) return [];

  const queryVector = await embedQuery(query);
  const supabase = getSupabase(); // rpc: firm filter applied by filterMatchesToFirm below

  const { data, error } = await supabase.rpc('match_embeddings', {
    query_embedding: JSON.stringify(queryVector),
    match_count: opts.limit ?? 10,
    match_threshold: opts.threshold ?? 0.3,
    filter_matter_id: opts.matterId ?? null,
  });

  if (error) {
    console.error('[embeddings] Search error:', error.message);
    return [];
  }

  const matches = (data as EmbeddingMatch[]) || [];
  return filterMatchesToFirm(matches, opts.firmId);
}

/**
 * Vector search restricted to specific source types. Unlike searchEmbeddings
 * (which ranks the global pool), this filters by source_type inside the query
 * so sparse types — e.g. kb_page — actually surface.
 */
export async function searchEmbeddingsByType(
  query: string,
  sourceTypes: SourceType[],
  opts: { firmId: string; limit?: number; threshold?: number; matterId?: string | null; metaKinds?: string[] },
): Promise<EmbeddingMatch[]> {
  // `ai_search` gates the read as well as the write: the query string is
  // itself firm content, and embedding it sends it to Voyage. Empty rather
  // than a throw — a firm that has not opted in has no vectors either, so []
  // is the true answer, and a background retrieval on a page must not 500.
  if (!(await isFeatureAvailable(opts.firmId, 'ai_search'))) return [];

  if (!isVoyageConfigured()) return [];
  if (sourceTypes.length === 0) return [];

  const queryVector = await embedQuery(query);
  const supabase = getSupabase(); // rpc: firm filter applied by filterMatchesToFirm below

  const { data, error } = await supabase.rpc('match_embeddings_by_type', {
    query_embedding: JSON.stringify(queryVector),
    p_source_types: sourceTypes,
    match_count: opts.limit ?? 10,
    match_threshold: opts.threshold ?? 0.25,
    filter_matter_id: opts.matterId ?? null,
    p_meta_kinds: opts.metaKinds && opts.metaKinds.length > 0 ? opts.metaKinds : null,
  });

  if (error) {
    console.error('[embeddings] Typed search error:', error.message);
    return [];
  }
  const matches = (data as EmbeddingMatch[]) || [];
  return filterMatchesToFirm(matches, opts.firmId);
}

// ── Internal Helpers ─────────────────────────────────────────────────

/**
 * Chunk, embed, and upsert embeddings for a source.
 */
async function upsertEmbeddings(
  sourceType: SourceType,
  sourceId: string,
  matterId: string | null,
  chunks: { index: number; text: string }[],
  metadata: Record<string, unknown>,
  firmId: string,
): Promise<number> {
  // The write path refuses outright: this is where firm content leaves for
  // Voyage and comes back as a stored derived copy. A silent skip here would
  // look exactly like an idle backfill.
  await requireAi({ firmId, feature: 'ai_search' });

  const supabase = getServiceDbForFirm(firmId);

  // Delete existing embeddings for this source (re-embed cleanly)
  await supabase
    .from('embeddings')
    .delete()
    .eq('source_type', sourceType)
    .eq('source_id', sourceId);

  // Batch embed all chunks
  const vectors = await embedTexts(chunks.map((c) => c.text));

  // Upsert rows
  const rows = chunks.map((chunk, i) => ({
    source_type: sourceType,
    source_id: sourceId,
    matter_id: matterId,
    chunk_index: chunk.index,
    chunk_text: chunk.text,
    embedding: JSON.stringify(vectors[i]),
    metadata,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('embeddings').upsert(rows, {
    onConflict: 'source_type,source_id,chunk_index',
  });

  if (error) {
    console.error(
      `[embeddings] Failed to upsert ${rows.length} embeddings for ${sourceType}/${sourceId}:`,
      error.message,
    );
    return 0;
  }

  console.log(
    `[embeddings] Generated ${rows.length} embeddings for ${sourceType}/${sourceId}`,
  );
  return rows.length;
}

/**
 * Get embedding stats (for admin dashboard).
 */
export async function getEmbeddingStats(firmId: string, matterId?: string) {
  const supabase = getServiceDbForFirm(firmId);

  let query = supabase
    .from('embeddings')
    .select('source_type', { count: 'exact' });

  if (matterId) {
    query = query.eq('matter_id', matterId);
  }

  const { count } = await query;

  // Get breakdown by source type
  const { data: breakdown } = await supabase.rpc('get_embedding_counts', {});

  return {
    total: count || 0,
    breakdown: breakdown || [],
  };
}

/**
 * Embed a batch of texts for one firm.
 *
 * The escape hatch for a caller that assembles its own rows and writes them
 * itself (`/api/embeddings/generate` builds one batch across a matter's whole
 * entity set). It exists so that route does not have to import
 * `@/lib/ai/voyage` directly — which would put a Voyage call outside the one
 * module holding the `ai_search` check, and `scripts/audit-ai-gate.ts` refuses
 * exactly that.
 */
export async function embedEntityTexts(
  firmId: string,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  await requireAi({ firmId, feature: 'ai_search' });
  return embedTexts(texts);
}
