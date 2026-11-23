import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import ClientDetail from '@/components/detail/ClientDetail';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'clients', idColumn: 'notion_id', id, nameColumn: 'name', fallback: 'Client' }) };
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;

  return (
    <ClientDetail id={id} />
  );
}
