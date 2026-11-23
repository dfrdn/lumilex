import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import CaseDetail from '@/components/detail/CaseDetail';
import { getCaseById } from '@/lib/queries/cases';
import { entityTitle } from '@/lib/page-metadata';
import { CASE_EDITORS } from '@/lib/cases/api';

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'cases', idColumn: 'id', id, nameColumn: 'title', fallback: 'Case' }) };
}

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;
  const data = await getCaseById(session.firmId, id);
  if (!data) notFound();

  return (
    <CaseDetail initial={data} canEdit={CASE_EDITORS.includes(session.user.role ?? '')} />
  );
}
