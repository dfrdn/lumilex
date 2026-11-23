// KB backfill orchestrator — mines the matter archive into firm-wide
// knowledge pages. Environment-agnostic: called from the API route with a
// bounded batch (serverless-timeout-safe) or from a script for the full
// archive. Idempotent: pages upsert by slug, citations/matters are
// replaced each run. Every page is written as a draft.

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { extractMatterKnowledge } from '@/lib/ai/kb-extractor';
import { writeKbPage } from '@/lib/ai/kb-page-writer';
import { generateEmbeddingsForEntity, deleteEmbeddingsForSource } from '@/lib/ai/embeddings';
import type { KbKind, KbSignalWithSource } from '@/lib/ai/kb-types';
import { kbSlug, KB_KIND_LABELS } from '@/lib/ai/kb-types';
import { MATTER_STATUS } from '@/lib/matter-status';

export interface KbBackfillScope {
  /** Matter statuses to mine. Default: closed matters. */
  statuses?: string[];
  /** Cap matters processed this run (serverless safety). null = all. */
  limit?: number | null;
  /** Only synthesize a page when at least this many matters contribute. */
  minContributors?: number;
  /** Restrict to specific kinds. Default: doctrine + template_clause. */
  kinds?: KbKind[];
  /** Explicit matter ids (overrides status filter) — for incremental ingest. */
  matterIds?: string[];
}

export interface KbBackfillStats {
  mattersProcessed: number;
  signalsExtracted: number;
  pagesWritten: number;
  pagesByKind: Record<string, number>;
  skippedBelowThreshold: number;
}

interface MatterRow {
  notion_id: string;
  name: string;
  case_title: string | null;
}

const DEFAULT_STATUSES: string[] = [MATTER_STATUS.DONE, MATTER_STATUS.ARCHIVED];
const DEFAULT_KINDS: KbKind[] = ['doctrine', 'template_clause', 'judge', 'court', 'opposing_counsel', 'opposing_party'];

/**
 * Run a backfill pass. Creates a kb_jobs row, processes matters, synthesizes
 * pages for entities that cross the contributor threshold, and records stats.
 */
export async function runKbBackfill(
  firmId: string,
  scope: KbBackfillScope,
  startedBy: string,
): Promise<{ jobId: number; stats: KbBackfillStats }> {
  const supabase = getServiceDbForFirm(firmId);
  const statuses = scope.statuses ?? DEFAULT_STATUSES;
  const minContributors = scope.minContributors ?? 2;
  const kinds = scope.kinds ?? DEFAULT_KINDS;
  const kindSet = new Set(kinds);

  const { data: job } = await supabase
    .from('kb_jobs')
    .insert({ kind: 'backfill', status: 'running', scope, started_by: startedBy })
    .select('id')
    .single();
  const jobId = job?.id as number;

  const stats: KbBackfillStats = {
    mattersProcessed: 0,
    signalsExtracted: 0,
    pagesWritten: 0,
    pagesByKind: {},
    skippedBelowThreshold: 0,
  };

  try {
    // ── Resolve the matter set ──
    let matters: MatterRow[] = [];
    if (scope.matterIds && scope.matterIds.length > 0) {
      const { data } = await supabase
        .from('matters')
        .select('notion_id, name, case_title')
        .in('notion_id', scope.matterIds);
      matters = (data ?? []) as MatterRow[];
    } else {
      let q = supabase
        .from('matters')
        .select('notion_id, name, case_title')
        .in('status', statuses)
        .order('date', { ascending: false, nullsFirst: false });
      if (scope.limit) q = q.limit(scope.limit);
      const { data } = await q;
      matters = (data ?? []) as MatterRow[];
    }

    // ── Extract signals from each matter, grouped by (kind, key) ──
    const groups = new Map<string, { kind: KbKind; key: string; title: string; signals: KbSignalWithSource[] }>();

    for (const matter of matters) {
      const result = await extractMatterKnowledge(matter.notion_id, firmId).catch((err) => {
        console.error(`[kb-backfill] Extraction failed for ${matter.notion_id}:`, err?.message ?? err);
        return null;
      });
      stats.mattersProcessed += 1;
      if (!result) continue;

      // Persist doctrine tags on the brief (join surface).
      if (result.doctrineTags.length > 0) {
        await supabase
          .from('matter_summaries')
          .update({ doctrine_tags: result.doctrineTags })
          .eq('matter_id', matter.notion_id);
      }

      for (const sig of result.signals) {
        if (!kindSet.has(sig.kind)) continue;
        stats.signalsExtracted += 1;
        const groupKey = `${sig.kind}::${sig.key}`;
        const entry = groups.get(groupKey) ?? { kind: sig.kind, key: sig.key, title: sig.title, signals: [] };
        entry.signals.push({
          ...sig,
          matterId: matter.notion_id,
          matterName: matter.case_title || matter.name,
          sourceType: 'matter_summary',
          sourceId: matter.notion_id,
        });
        groups.set(groupKey, entry);
      }
    }

    // ── Synthesize a page per entity that crosses the threshold ──
    for (const group of groups.values()) {
      // Distinct contributing matters.
      const matterIds = [...new Set(group.signals.map((s) => s.matterId))];
      if (matterIds.length < minContributors) {
        stats.skippedBelowThreshold += 1;
        continue;
      }

      const draft = await writeKbPage({
        firmId,
        kind: group.kind,
        title: group.title,
        signals: group.signals,
      }).catch((err) => {
        console.error(`[kb-backfill] Page write failed for ${group.kind}/${group.key}:`, err?.message ?? err);
        return null;
      });
      if (!draft || !draft.contentMd) continue;

      const slug = kbSlug(group.kind, group.key);
      await upsertKbPage(firmId, slug, group, draft, matterIds);

      stats.pagesWritten += 1;
      stats.pagesByKind[group.kind] = (stats.pagesByKind[group.kind] ?? 0) + 1;
    }

    await supabase
      .from('kb_jobs')
      .update({ status: 'completed', stats, completed_at: new Date().toISOString() })
      .eq('id', jobId);

    return { jobId, stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backfill failed';
    console.error('[kb-backfill] Job failed:', message);
    await supabase
      .from('kb_jobs')
      .update({ status: 'failed', error: message, stats, completed_at: new Date().toISOString() })
      .eq('id', jobId);
    throw err;
  }
}

/**
 * Upsert one page by slug, replacing its citations + contributing matters,
 * and re-embedding its content. Existing manual edits are preserved by NOT
 * overwriting a page that a human has moved past 'draft' (published/review)
 * unless it's still llm-owned.
 */
async function upsertKbPage(
  firmId: string,
  slug: string,
  group: { kind: KbKind; key: string; title: string },
  draft: { contentMd: string; summary: string; citations: { matterId: string; sourceType: string; sourceId: string; excerpt: string; confidence: number }[]; model: string },
  matterIds: string[],
): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);

  const { data: existing } = await supabase
    .from('kb_pages')
    .select('id, status, generated_by, version')
    .eq('slug', slug)
    .maybeSingle();

  // Never clobber lawyer-curated pages. Once a human takes a page to
  // review/published, backfill leaves the content alone.
  if (existing && existing.generated_by === 'manual') return;
  if (existing && ['review', 'published'].includes(existing.status)) return;

  const now = new Date().toISOString();
  let pageId: number;

  if (existing) {
    pageId = existing.id;
    await supabase
      .from('kb_pages')
      .update({
        title: group.title,
        content_md: draft.contentMd,
        summary: draft.summary,
        model_used: draft.model,
        generated_by: 'llm',
        version: (existing.version ?? 1) + 1,
        last_generated_at: now,
        updated_at: now,
      })
      .eq('id', pageId);
  } else {
    const { data: inserted } = await supabase
      .from('kb_pages')
      .insert({
        slug,
        kind: group.kind,
        title: group.title,
        content_md: draft.contentMd,
        summary: draft.summary,
        status: 'draft',
        generated_by: 'llm',
        model_used: draft.model,
        last_generated_at: now,
      })
      .select('id')
      .single();
    pageId = inserted!.id;
  }

  // Replace citations + contributing matters.
  await supabase.from('kb_page_citations').delete().eq('kb_page_id', pageId);
  if (draft.citations.length > 0) {
    await supabase.from('kb_page_citations').insert(
      draft.citations.map((c) => ({
        kb_page_id: pageId,
        source_type: c.sourceType,
        source_id: c.sourceId,
        matter_id: c.matterId,
        excerpt: c.excerpt,
        confidence: c.confidence,
      })),
    );
  }

  await supabase.from('kb_page_matters').delete().eq('kb_page_id', pageId);
  await supabase.from('kb_page_matters').insert(
    matterIds.map((m) => ({ kb_page_id: pageId, matter_id: m })),
  );

  // Re-embed the page content for semantic retrieval (drafting + search).
  await deleteEmbeddingsForSource('kb_page', String(pageId), firmId).catch(() => {});
  await generateEmbeddingsForEntity(
    'kb_page',
    String(pageId),
    null,
    `${group.title} (${KB_KIND_LABELS[group.kind]})\n\n${draft.contentMd}`,
    { kind: group.kind, title: group.title, slug },
    firmId,
  ).catch((err) => console.error(`[kb-backfill] Embedding failed for page ${pageId}:`, err?.message ?? err));
}
