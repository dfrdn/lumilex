import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import TaskDetail from '@/components/detail/TaskDetail';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'tasks', idColumn: 'notion_id', id, nameColumn: 'name', fallback: 'Task' }) };
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;

  return (
    <TaskDetail id={id} />
  );
}
