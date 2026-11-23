import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { CheckSquare } from 'lucide-react';
import { getAllTasks } from '@/lib/queries/listing';
import PageHeader from '@/components/ui/PageHeader';
import TasksTable from './TasksTable';

export const metadata: Metadata = { title: 'Tasks' };

export const revalidate = 30;

export default async function TasksPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const userId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';
  const userName = session.user.name ?? '';
  const tasks = await getAllTasks(session.firmId);

  return (
    <>
      <PageHeader icon={<CheckSquare className="w-5 h-5" />} title="All Tasks" subtitle="Browse all open tasks" />
      <TasksTable data={tasks} userId={userId} role={role} />
    </>
  );
}
