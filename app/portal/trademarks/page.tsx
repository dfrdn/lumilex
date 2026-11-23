import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPortalSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getPortalClientName } from '@/lib/portal/data';
import { portalSubjects } from '@/lib/portal/companies';
import { loadPortalTrademarks } from '@/lib/portal/trademarks';
import { manilaToday } from '@/lib/corporations/status';
import PortalHeader from '../PortalHeader';
import PortalFooter from '../PortalFooter';
import PortalTrademarksView from './PortalTrademarksView';

export const metadata: Metadata = { title: 'Trademarks' };

export const dynamic = 'force-dynamic';

export default async function PortalTrademarksPage() {
  const session = await getPortalSession();
  if (!session) redirect('/portal/login');

  // A client's JWT reads no firm table; the loaders scope to the session's client.
  const db = getServiceDbForFirm(session.firmId);
  const [marks, clientName, subjects] = await Promise.all([
    loadPortalTrademarks(db, session.user.clientId),
    getPortalClientName(session.firmId, session.user.clientId),
    portalSubjects(db, session.user.clientId),
  ]);

  return (
    <>
      <PortalHeader clientName={clientName ?? session.user.clientId} subjects={subjects} />
      <PortalTrademarksView marks={marks} basePath="/portal" today={manilaToday()} />
      <PortalFooter />
    </>
  );
}
