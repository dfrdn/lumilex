import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { RULE_SOURCES, ruleAnchor, rulesPartSlug, ruleSectionAnchor } from '@/lib/rules/model';
import type { RuleSource } from '@/lib/rules/parse-rules-of-court';

/**
 * /dashboard/library/rules/civil/41?section=3 → the Library page for the
 * Rules of Civil Procedure, at Rule 41, Section 3. A citation can be linked
 * from anywhere without first looking up the page id.
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
  const { data: page } = await supabase.from('kb_pages').select('id').eq('slug', rulesPartSlug(source as RuleSource)).maybeSingle();
  if (!page) notFound();

  const anchor = section && /^\d{1,3}$/.test(section) ? ruleSectionAnchor(Number(rule), Number(section)) : ruleAnchor(Number(rule));
  redirect(`/dashboard/library/${page.id}#${anchor}`);
}
