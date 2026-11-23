import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import MyTasksContent from '@/components/shared/MyTasksContent';

export const metadata: Metadata = { title: 'My Tasks' };

export const revalidate = 30;

export default async function MyTasksPage() {
  const session = await requireRouteAccess('/admin/my-tasks');

  return (
    <MyTasksContent shellMode="admin" userId={session.user.notionUserId} />
  );
}
