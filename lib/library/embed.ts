import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isFeatureAvailable } from '@/lib/firm/features';
import { generateEmbeddingsForEntity, deleteEmbeddingsForSource } from '@/lib/ai/embeddings';
import { kindLabel, plainText, type ContentFormat } from '@/lib/library/model';

/**
 * Refresh a Library page's chunks in the vector index. The embeddings table
 * has no policies, so this reads and writes through the firm-scoped service
 * client. A firm without `ai_search` keeps no vectors at all, which is the
 * true state rather than a skipped step, so an edit there returns without
 * embedding. Callers treat the whole thing as best-effort: a failure is
 * logged and the page edit stands.
 */
export async function reembedLibraryPage(firmId: string, pageId: number): Promise<void> {
  if (!(await isFeatureAvailable(firmId, 'ai_search'))) return;

  const { data: p } = await getServiceDbForFirm(firmId)
    .from('kb_pages')
    .select('kind, title, content_md, content_format, slug')
    .eq('id', pageId)
    .maybeSingle();
  if (!p) return;

  await deleteEmbeddingsForSource('kb_page', String(pageId), firmId).catch(() => {});
  const body = plainText(p.content_md ?? '', (p.content_format as ContentFormat) ?? 'md');
  if (!body.trim()) return;
  await generateEmbeddingsForEntity(
    'kb_page',
    String(pageId),
    null,
    `${p.title} (${kindLabel(p.kind)})\n\n${body}`,
    { kind: p.kind, title: p.title, slug: p.slug },
    firmId,
  );
}
