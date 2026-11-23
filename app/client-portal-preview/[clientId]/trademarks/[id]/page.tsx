import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadPortalTrademark } from '@/lib/portal/trademarks';
import { manilaToday } from '@/lib/corporations/status';
import PortalTrademarkView from '@/app/portal/trademarks/[id]/PortalTrademarkView';
import { requirePreviewAccess } from '../../access';

export const metadata: Metadata = { title: 'Portal preview · Trademark' };

export const dynamic = 'force-dynamic';

export default async function PreviewTrademarkPage({ params }: { params: Promise<{ clientId: string; id: string }> }) {
  const session = await requirePreviewAccess();
  const { clientId, id } = await params;
  const data = await loadPortalTrademark(getServiceDbForFirm(session.firmId), clientId, id);
  if (!data) notFound();
  return <PortalTrademarkView data={data} basePath={`/client-portal-preview/${clientId}`} today={manilaToday()} />;
}
