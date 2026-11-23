import type { Metadata } from 'next';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import PortalBillingView from '@/app/portal/billing/PortalBillingView';
import { loadPortalBilling } from '@/lib/portal/data';
import { requirePreviewAccess } from '../access';

export const metadata: Metadata = { title: 'Portal preview · Billing' };

export const dynamic = 'force-dynamic';

export default async function PreviewBillingPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const session = await requirePreviewAccess();
  const { clientId } = await params;

  const { invoices, payments, deposits } = await loadPortalBilling(
    getServiceDbForFirm(session.firmId),
    clientId,
  );

  return <PortalBillingView invoices={invoices} payments={payments} deposits={deposits} preview />;
}
