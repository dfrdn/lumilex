import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import FileDetail from '@/components/detail/FileDetail';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'files', idColumn: 'notion_id', id, nameColumn: 'name', fallback: 'File' }) };
}

export default async function FileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;

  return (
    <FileDetail id={id} />
  );
}
