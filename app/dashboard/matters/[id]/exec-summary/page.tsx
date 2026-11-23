import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import ExecSummaryView from './ExecSummaryView';
import { fetchEntityName } from '@/lib/page-metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const name = await fetchEntityName('matters', 'notion_id', id, 'name');
  return { title: name ? `Exec Summary · ${name}` : 'Executive Summary' };
}

export default async function ExecSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;
  const supabase = getServiceDbForFirm(session.firmId);

  const { data: matter } = await supabase
    .from('matters')
    .select('notion_id, name, matter_code, case_title, case_number, court, client_name, is_case, status')
    .eq('notion_id', id)
    .single();

  if (!matter) notFound();

  const { data: summary } = await supabase
    .from('matter_exec_summaries')
    .select('*')
    .eq('matter_id', id)
    .maybeSingle();

  return <ExecSummaryView matter={matter} summary={summary} />;
}
