import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPortalClientName } from '@/lib/portal/data';
import { isFeatureAvailable } from '@/lib/firm/features';
import PortalPreviewChrome from './PortalPreviewChrome';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { portalSubjects } from '@/lib/portal/companies';
import { requirePreviewAccess } from './access';

export const metadata: Metadata = { title: 'Portal preview' };

export const dynamic = 'force-dynamic';

export default async function PortalPreviewLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const session = await requirePreviewAccess();
  if (!(await isFeatureAvailable(session.firmId, 'portal'))) notFound();

  const { clientId } = await params;
  const clientName = await getPortalClientName(session.firmId, clientId);
  if (clientName === null) notFound();
  const subjects = await portalSubjects(getServiceDbForFirm(session.firmId), clientId);

  return (
    <PortalPreviewChrome clientId={clientId} clientName={clientName} subjects={subjects}>
      {children}
    </PortalPreviewChrome>
  );
}
