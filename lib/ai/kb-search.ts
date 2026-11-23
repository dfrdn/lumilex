// KB retrieval — semantic search over published/draft knowledge pages.
// Used by the Knowledge Library search box and (Phase 2) the Drafting
// Studio to ground drafts in the firm's own doctrine + template clauses.

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { searchEmbeddingsByType } from '@/lib/ai/embeddings';
import type { KbKind, KbStatus } from '@/lib/ai/kb-types';

export interface KbSearchHit {
  id: number;
  slug: string;
  kind: KbKind;
  title: string;
  summary: string;
  status: KbStatus;
  similarity: number;
  snippet: string;
}

/**
 * Semantic search over KB page embeddings. Post-filters the global
 * match_embeddings results to source_type='kb_page' and resolves the page
 * rows. `statuses` defaults to lawyer-trusted pages (published + draft;
 * exclude archived/stale).
 */
export async function semanticKbSearch(
  query: string,
  opts: { firmId: string; limit?: number; kinds?: KbKind[]; statuses?: KbStatus[] },
): Promise<KbSearchHit[]> {
  const limit = opts.limit ?? 8;
  const statuses = opts.statuses ?? ['published', 'draft', 'review'];

  // Filter to kb_page AND the requested kinds INSIDE the vector query
  // (kb_page chunks are sparse and the kind lives in embedding metadata) so
  // off-kind pages can't crowd the requested kinds out of the top-K window.
  // Over-fetch generously: each page is several chunks, and status is still
  // filtered after — headroom absorbs both collapses.
  const kbMatches = await searchEmbeddingsByType(query, ['kb_page'], {
    limit: Math.max(limit * 6, 40),
    threshold: 0.25,
    metaKinds: opts.kinds,
    firmId: opts.firmId,
  });
  if (kbMatches.length === 0) return [];

  // Best similarity per page id.
  const bySource = new Map<string, { similarity: number; snippet: string }>();
  for (const m of kbMatches) {
    const existing = bySource.get(m.source_id);
    if (!existing || m.similarity > existing.similarity) {
      bySource.set(m.source_id, { similarity: m.similarity, snippet: m.chunk_text.slice(0, 240) });
    }
  }

  const ids = [...bySource.keys()].map((s) => Number(s)).filter((n) => !Number.isNaN(n));
  if (ids.length === 0) return [];

  // Resolve page rows; kind already filtered in-query, status filtered here.
  const supabase = getServiceDbForFirm(opts.firmId);
  const { data: pages } = await supabase
    .from('kb_pages')
    .select('id, slug, kind, title, summary, status')
    .in('id', ids)
    .in('status', statuses);
  if (!pages) return [];

  return pages
    .map((p) => {
      const hit = bySource.get(String(p.id));
      return {
        id: p.id as number,
        slug: p.slug as string,
        kind: p.kind as KbKind,
        title: p.title as string,
        summary: p.summary as string,
        status: p.status as KbStatus,
        similarity: hit?.similarity ?? 0,
        snippet: hit?.snippet ?? '',
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
