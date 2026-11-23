import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPortalSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import PortalHeader from './PortalHeader';
import PortalFooter from './PortalFooter';
import PortalLandingView from './PortalLandingView';
import { loadPortalMatters, loadPortalWorkDelivered, getPortalClientName } from '@/lib/portal/data';
import { getGreeting, getFirstName } from './greeting';
import { portalSubjects } from '@/lib/portal/companies';

export const metadata: Metadata = { title: 'Client Portal' };

export const dynamic = 'force-dynamic';

export default async function PortalLandingPage() {
  const session = await getPortalSession();
  if (!session) redirect('/portal/login');

  // A client's JWT reads no firm table; the loaders scope to the session's client.
  const db = getServiceDbForFirm(session.firmId);
  const [rows, clientName, subjects] = await Promise.all([
    loadPortalMatters(db, session.user.clientId),
    getPortalClientName(session.firmId, session.user.clientId),
    portalSubjects(db, session.user.clientId),
  ]);
  const workDelivered = await loadPortalWorkDelivered(
    db,
    rows.map((r) => r.notion_id),
  );

  return (
    <>
      <PortalHeader clientName={clientName ?? session.user.clientId} subjects={subjects} />
      <PortalLandingView
        rows={rows}
        workDelivered={workDelivered}
        greeting={getGreeting()}
        firstName={getFirstName(session.user.name)}
        basePath="/portal"
      />
      <PortalFooter />
    </>
  );
}
