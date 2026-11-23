import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import PortalLandingView from '@/app/portal/PortalLandingView';
import { loadPortalMatters, loadPortalWorkDelivered } from '@/lib/portal/data';
import { getGreeting } from '@/app/portal/greeting';
import { requirePreviewAccess } from './access';

export const dynamic = 'force-dynamic';

export default async function PreviewLandingPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const session = await requirePreviewAccess();
  const { clientId } = await params;

  // Firm-scoped service read, explicitly scoped to this client by the loader.
  const service = getServiceDbForFirm(session.firmId);
  const rows = await loadPortalMatters(service, clientId);
  const workDelivered = await loadPortalWorkDelivered(
    service,
    rows.map((r) => r.notion_id),
  );

  return (
    <PortalLandingView
      rows={rows}
      workDelivered={workDelivered}
      greeting={getGreeting()}
      firstName=""
      basePath={`/client-portal-preview/${clientId}`}
    />
  );
}
