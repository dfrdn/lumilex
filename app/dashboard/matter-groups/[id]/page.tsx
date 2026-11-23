import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import MatterGroupDetail from '@/components/detail/MatterGroupDetail';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'matters', idColumn: 'notion_id', id, nameColumn: 'name', fallback: 'Matter Group' }) };
}

export default async function MatterGroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ matters?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;
  const { matters } = await searchParams;
  const selectedMatterIds = matters
    ? matters.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  return (
    <MatterGroupDetail rootId={id} selectedMatterIds={selectedMatterIds} />
  );
}
