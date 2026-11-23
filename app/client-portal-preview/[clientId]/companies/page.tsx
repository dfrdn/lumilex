import type { Metadata } from 'next';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadPortalCompanies } from '@/lib/portal/companies';
import { manilaToday } from '@/lib/corporations/status';
import PortalCompaniesView from '@/app/portal/companies/PortalCompaniesView';
import { requirePreviewAccess } from '../access';

export const metadata: Metadata = { title: 'Portal preview · Companies' };

export const dynamic = 'force-dynamic';

export default async function PreviewCompaniesPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await requirePreviewAccess();
  const { clientId } = await params;
  const companies = await loadPortalCompanies(getServiceDbForFirm(session.firmId), clientId);
  return <PortalCompaniesView companies={companies} basePath={`/client-portal-preview/${clientId}`} today={manilaToday()} />;
}
