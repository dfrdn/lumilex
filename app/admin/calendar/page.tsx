import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import AdminCalendarPage from '@/components/admin/AdminCalendarPage';

export const metadata: Metadata = { title: 'Calendar' };

export default async function AdminCalendarRoute() {
  await requireRouteAccess('/admin/calendar');

  return (
    <AdminCalendarPage />
  );
}
