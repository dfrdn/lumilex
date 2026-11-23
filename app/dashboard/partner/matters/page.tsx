import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import MattersManagementPage from './MattersManagementPage';

export const metadata: Metadata = { title: 'Matter Management' };

export default async function DashboardPartnerMattersRoute() {
  await requireRouteAccess('/dashboard/partner/matters');

  return (
    <MattersManagementPage />
  );
}
