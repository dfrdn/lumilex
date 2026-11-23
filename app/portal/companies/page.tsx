import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPortalSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getPortalClientName } from '@/lib/portal/data';
import { loadPortalCompanies, portalSubjects } from '@/lib/portal/companies';
import { manilaToday } from '@/lib/corporations/status';
import PortalHeader from '../PortalHeader';
import PortalFooter from '../PortalFooter';
import PortalCompaniesView from './PortalCompaniesView';

export const metadata: Metadata = { title: 'Companies' };

export const dynamic = 'force-dynamic';

export default async function PortalCompaniesPage() {
  const session = await getPortalSession();
  if (!session) redirect('/portal/login');

  // A client's JWT reads no firm table; the loaders scope to the session's client.
  const db = getServiceDbForFirm(session.firmId);
  const [companies, clientName, subjects] = await Promise.all([
    loadPortalCompanies(db, session.user.clientId),
    getPortalClientName(session.firmId, session.user.clientId),
    portalSubjects(db, session.user.clientId),
  ]);

  return (
    <>
      <PortalHeader clientName={clientName ?? session.user.clientId} subjects={subjects} />
      <PortalCompaniesView companies={companies} basePath="/portal" today={manilaToday()} />
      <PortalFooter />
    </>
  );
}
