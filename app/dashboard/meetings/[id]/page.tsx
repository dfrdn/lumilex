import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import MeetingDetail from '@/components/detail/MeetingDetail';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'meetings', idColumn: 'notion_id', id, nameColumn: 'name', fallback: 'Meeting' }) };
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;

  return (
    <MeetingDetail id={id} />
  );
}
