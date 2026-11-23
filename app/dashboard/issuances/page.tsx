import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import { isFeatureAvailable } from '@/lib/firm/features';
import { redirect } from 'next/navigation';
import IssuancesPage from '@/components/issuances/IssuancesPage';

export const metadata: Metadata = { title: 'Issuances' };

export default async function DashboardIssuancesRoute() {
  const session = await requireRouteAccess('/dashboard/issuances');
  const role = session.user.role ?? 'lawyer';
  if (!(await isFeatureAvailable(session.firmId, 'issuances'))) redirect('/dashboard');
  const canEdit = role === 'partner' || role === 'admin' || role === 'super_user';

  return (
    <IssuancesPage canEdit={canEdit} variant="lawyer" />
  );
}
