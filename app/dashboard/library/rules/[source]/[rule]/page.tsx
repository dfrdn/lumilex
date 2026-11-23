import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { RULE_SOURCES, ruleSlug } from '@/lib/rules/model';
import type { RuleSource } from '@/lib/rules/parse-rules-of-court';

/**
 * /dashboard/library/rules/civil/41?section=3 → the Library page for Rule 41,
 * scrolled to Section 3. A citation can be linked from anywhere without first
 * looking up the page id.
 */
export default async function RuleRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ source: string; rule: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { source, rule } = await params;
  const { section } = await searchParams;
  if (!(RULE_SOURCES as string[]).includes(source) || !/^\d{1,3}$/.test(rule)) notFound();

  const supabase = await getSupabaseServerAuthClient();
  const { data: page } = await supabase.from('kb_pages').select('id').eq('slug', ruleSlug(source as RuleSource, Number(rule))).maybeSingle();
  if (!page) notFound();

  redirect(`/dashboard/library/${page.id}${section && /^\d{1,3}$/.test(section) ? `?section=${section}` : ''}`);
}
