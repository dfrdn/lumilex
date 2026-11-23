import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { sanitizeHandbookHtml } from '@/lib/sanitize-html';
import { isRulesKind, type LibraryCitation, type LibraryContributor, type LibraryPageFull } from '@/lib/library/model';
import { SOURCE_META, type RuleSource } from '@/lib/rules/parse-rules-of-court';
import { sectionAnchor } from '@/lib/rules/model';

export interface RulesPageMeta {
  source: RuleSource;
  sourceLabel: string;
  issuance: string;
  effective: string;
  officialUrl: string;
  rule: number;
  part: string | null;
  sections: { section: number; title: string; anchor: string }[];
  prev: { id: number; title: string } | null;
  next: { id: number; title: string } | null;
}

/** What the Library shows above a Rules of Court page: its publication and its neighbours. */
async function loadRulesMeta(pageId: number): Promise<RulesPageMeta | null> {
  const supabase = await getSupabaseServerAuthClient();
  const { data: sections } = await supabase
    .from('court_rule_sections')
    .select('source, rule, part, section, title')
    .eq('kb_page_id', pageId)
    .order('section');
  const first = sections?.[0];
  if (!first) return null;
  const source = first.source as RuleSource;
  const meta = SOURCE_META[source];

  const { data: siblings } = await supabase
    .from('kb_pages')
    .select('id, slug, title')
    .eq('kind', 'rules_of_court')
    .like('slug', `rules-of-court-${source}-rule-%`);
  const ordered = (siblings ?? [])
    .map((p) => ({ ...p, rule: Number(p.slug.split('-rule-')[1]) }))
    .filter((p) => Number.isFinite(p.rule))
    .sort((a, b) => a.rule - b.rule);
  const at = ordered.findIndex((p) => p.id === pageId);

  return {
    source,
    sourceLabel: meta.short,
    issuance: meta.issuance,
    effective: meta.effective,
    officialUrl: meta.url,
    rule: first.rule,
    part: first.part,
    sections: (sections ?? []).map((s) => ({ section: s.section, title: s.title, anchor: sectionAnchor(s.section, s.title) })),
    prev: at > 0 ? { id: ordered[at - 1].id, title: ordered[at - 1].title } : null,
    next: at >= 0 && at < ordered.length - 1 ? { id: ordered[at + 1].id, title: ordered[at + 1].title } : null,
  };
}

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
  rules: RulesPageMeta | null;
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
    rules: isRulesKind(page.kind) ? await loadRulesMeta(id) : null,
  };
}
