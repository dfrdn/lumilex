import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import DTRReviewDashboard from '@/components/finance/DTRReviewDashboard';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';

export const metadata: Metadata = { title: 'Billing Review' };

export const revalidate = 0;

export default async function PartnerBillingReviewPage() {
  const session = await requireRouteAccess('/dashboard/partner/billing-review');

  const isMP = await isManagingPartner(session.user.notionUserId, session.firmId);

  return (
    <DTRReviewDashboard
      currentUserId={session.user.notionUserId}
      mode="partner"
      isManagingPartner={isMP}
    />
  );
}
