import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import LawyersPage from '@/components/partner-lawyers/LawyersPage';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';

export const metadata: Metadata = { title: 'Lawyers' };

export default async function DashboardPartnerLawyersRoute() {
  const session = await requireRouteAccess('/dashboard/partner/lawyers');

  const canEditSalary = await isManagingPartner(session.user.notionUserId, session.firmId);

  return (
    <LawyersPage canEditSalary={canEditSalary} />
  );
}
