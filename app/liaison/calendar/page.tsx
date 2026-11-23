import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import DashboardCalendarPage from '@/components/dashboard/DashboardCalendarPage';

export const metadata: Metadata = { title: 'Firm Calendar' };

export default async function LiaisonCalendarPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <DashboardCalendarPage />
  );
}
