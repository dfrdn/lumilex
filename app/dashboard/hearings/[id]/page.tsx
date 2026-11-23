import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import HearingDetail from '@/components/detail/HearingDetail';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'hearings', idColumn: 'notion_id', id, nameColumn: 'name', fallback: 'Hearing' }) };
}

export default async function HearingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;

  return (
    <HearingDetail id={id} />
  );
}
