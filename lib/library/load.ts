import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { sanitizeHandbookHtml } from '@/lib/sanitize-html';
import { type LibraryCitation, type LibraryContributor, type LibraryPageFull } from '@/lib/library/model';
import { loadStatute, type StatuteDoc } from '@/lib/library/statute';

/**
 * One Library page with its citations and contributing matters, names
 * resolved for display. Reads through the caller's RLS-scoped client, so a
 * page the caller may not see — another firm's, or one limited to roles the
 * caller does not hold — comes back null.
 *
 * HTML is sanitized here as well as on write: pages written before the write
 * path sanitized are rendered with `dangerouslySetInnerHTML` too.
 */
export async function loadLibraryPage(id: number): Promise<{
  page: LibraryPageFull;
  citations: LibraryCitation[];
  contributors: LibraryContributor[];
} | null> {
  const supabase = await getSupabaseServerAuthClient();
  const { data: page } = await supabase.from('kb_pages').select('*').eq('id', id).maybeSingle();
  if (!page) return null;

  const [{ data: citations }, { data: matterLinks }] = await Promise.all([
    supabase
      .from('kb_page_citations')
      .select('id, source_type, source_id, matter_id, excerpt, confidence')
      .eq('kb_page_id', id)
      .order('confidence', { ascending: false }),
    supabase.from('kb_page_matters').select('matter_id').eq('kb_page_id', id),
  ]);

  const matterIds = [
    ...new Set([
      ...(citations ?? []).map((c) => c.matter_id).filter(Boolean),
      ...(matterLinks ?? []).map((m) => m.matter_id),
    ]),
  ] as string[];
  const names = new Map<string, { name: string; code: string | null }>();
  if (matterIds.length > 0) {
    const { data: matters } = await supabase
      .from('matters')
      .select('notion_id, name, case_title, matter_code')
      .in('notion_id', matterIds);
    for (const m of matters ?? []) names.set(m.notion_id, { name: m.case_title || m.name, code: m.matter_code });
  }

  const citationRows: LibraryCitation[] = (citations ?? []).map((c) => ({
    id: c.id,
    source_type: c.source_type,
    matter_id: c.matter_id,
    matter_name: c.matter_id ? names.get(c.matter_id)?.name ?? c.matter_id : null,
    excerpt: c.excerpt,
    confidence: c.confidence,
  }));
  const contributors: LibraryContributor[] = (matterLinks ?? []).map((m) => ({
    matter_id: m.matter_id,
    matter_name: names.get(m.matter_id)?.name ?? m.matter_id,
    matter_code: names.get(m.matter_id)?.code ?? null,
  }));

  const full = page as Omit<LibraryPageFull, 'contributorCount'>;
  return {
    page: {
      ...full,
      content_md: full.content_format === 'html' ? sanitizeHandbookHtml(full.content_md ?? '') : full.content_md,
      contributorCount: contributors.length,
    },
    citations: citationRows,
    contributors,
  };
}

/**
 * A code or a book of the Rules, read whole: the page and every provision.
 * Kept apart from loadLibraryPage so the page API does not ship two
 * thousand articles with every request.
 */
export async function loadStatutePage(page: { id: number; kind: string; slug: string }): Promise<StatuteDoc | null> {
  return loadStatute(await getSupabaseServerAuthClient(), page);
}
