import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { isFeatureAvailable } from '@/lib/firm/features';
import { redirect } from 'next/navigation';
import { Search } from 'lucide-react';

import PageHeader from '@/components/ui/PageHeader';
import { getEmbeddingStats } from '@/lib/ai/embeddings';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import SearchClient from './SearchClient';

export const metadata: Metadata = { title: 'Search' };

export const dynamic = 'force-dynamic';

export default async function SearchPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  if (!(await isFeatureAvailable(session.firmId, 'ai_search'))) redirect('/dashboard');

  // Indexed-chunk count for the header subtitle.
  const stats = await getEmbeddingStats(session.firmId).catch(() => ({ total: 0 }));

  // Matters for the filter dropdown, limited to the ones this person can open.
  const supabase = await getSupabaseServerAuthClient();
  const { data: matters } = await supabase
    .from('matters')
    .select('notion_id, name, matter_code')
    .order('name', { ascending: true })
    .limit(1000);

  return (
    <>
      <PageHeader
        icon={<Search className="w-5 h-5" />}
        title="Search"
        subtitle={`Find anything the firm has filed, received, or written — by its exact words, a party or docket number, or by describing it. ${stats.total.toLocaleString()} indexed passages across pleadings, memos, briefs, hearings, files and the Library, plus Supreme Court jurisprudence.`}
      />
      <SearchClient matters={matters ?? []} />
    </>
  );
}
