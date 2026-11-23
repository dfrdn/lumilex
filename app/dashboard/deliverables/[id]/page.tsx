import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import DeliverableDetail from '@/components/detail/DeliverableDetail';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'deliverables', idColumn: 'notion_id', id, nameColumn: 'name', fallback: 'Deliverable' }) };
}

export default async function DeliverableDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;

  return (
    <DeliverableDetail id={id} />
  );
}
