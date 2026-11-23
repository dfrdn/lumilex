import type { Metadata } from 'next';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadPortalTrademarks } from '@/lib/portal/trademarks';
import { manilaToday } from '@/lib/corporations/status';
import PortalTrademarksView from '@/app/portal/trademarks/PortalTrademarksView';
import { requirePreviewAccess } from '../access';

export const metadata: Metadata = { title: 'Portal preview · Trademarks' };

export const dynamic = 'force-dynamic';

export default async function PreviewTrademarksPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await requirePreviewAccess();
  const { clientId } = await params;
  const marks = await loadPortalTrademarks(getServiceDbForFirm(session.firmId), clientId);
  return <PortalTrademarksView marks={marks} basePath={`/client-portal-preview/${clientId}`} today={manilaToday()} />;
}
