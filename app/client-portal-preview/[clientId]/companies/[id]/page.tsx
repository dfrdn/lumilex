import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadPortalCompany } from '@/lib/portal/companies';
import { manilaToday } from '@/lib/corporations/status';
import PortalCompanyView from '@/app/portal/companies/[id]/PortalCompanyView';
import { requirePreviewAccess } from '../../access';

export const metadata: Metadata = { title: 'Portal preview · Company' };

export const dynamic = 'force-dynamic';

export default async function PreviewCompanyPage({ params }: { params: Promise<{ clientId: string; id: string }> }) {
  const session = await requirePreviewAccess();
  const { clientId, id } = await params;
  const data = await loadPortalCompany(getServiceDbForFirm(session.firmId), clientId, id);
  if (!data) notFound();
  return <PortalCompanyView data={data} basePath={`/client-portal-preview/${clientId}`} today={manilaToday()} preview />;
}
