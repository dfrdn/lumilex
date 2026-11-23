import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import MatterDetail from '@/components/detail/MatterDetail';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: await entityTitle({ table: 'matters', idColumn: 'notion_id', id, nameColumn: 'name', fallback: 'Matter' }) };
}

export default async function MatterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;

  return (
    <MatterDetail id={id} />
  );
}
