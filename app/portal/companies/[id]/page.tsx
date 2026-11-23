import { notFound, redirect } from 'next/navigation';
import { getPortalSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getPortalClientName } from '@/lib/portal/data';
import { loadPortalCompany, portalSubjects } from '@/lib/portal/companies';
import { manilaToday } from '@/lib/corporations/status';
import { portalSubjectTitle } from '@/lib/portal/page-title';
import PortalHeader from '../../PortalHeader';
import PortalFooter from '../../PortalFooter';
import PortalCompanyView from './PortalCompanyView';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await portalSubjectTitle(id, 'Company') };
}

export const dynamic = 'force-dynamic';

export default async function PortalCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getPortalSession();
  if (!session) redirect('/portal/login');

  const { id } = await params;
  // A client's JWT reads no firm table; the loaders scope to the session's client.
  const db = getServiceDbForFirm(session.firmId);
  const [data, clientName, subjects] = await Promise.all([
    loadPortalCompany(db, session.user.clientId, id),
    getPortalClientName(session.firmId, session.user.clientId),
    portalSubjects(db, session.user.clientId),
  ]);
  if (!data) notFound();

  return (
    <>
      <PortalHeader clientName={clientName ?? session.user.clientId} subjects={subjects} />
      <PortalCompanyView data={data} basePath="/portal" today={manilaToday()} />
      <PortalFooter />
    </>
  );
}
