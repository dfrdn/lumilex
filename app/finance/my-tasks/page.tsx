import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import MyTasksContent from '@/components/shared/MyTasksContent';

export const metadata: Metadata = { title: 'My Tasks' };

export const revalidate = 30;

export default async function FinanceMyTasksPage() {
  const session = await requireRouteAccess('/finance/my-tasks');

  return (
    <MyTasksContent shellMode="finance" userId={session.user.notionUserId} />
  );
}
