import { notFound, redirect } from 'next/navigation';
import { getPortalSession } from '@/lib/session';
import PortalHeader from '../../PortalHeader';
import PortalFooter from '../../PortalFooter';
import PortalMatterDetailView from './PortalMatterDetailView';
import { loadPortalMatterDetail, getPortalClientName } from '@/lib/portal/data';
import { portalSubjects } from '@/lib/portal/companies';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { portalMatterTitle } from '@/lib/portal/page-title';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await portalMatterTitle(id) };
}

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export default async function PortalMatterDetailPage({ params }: Params) {
  const session = await getPortalSession();
  if (!session) redirect('/portal/login');

  const { id } = await params;

  const [data, clientName, subjects] = await Promise.all([
    loadPortalMatterDetail(session.firmId, session.user.clientId, id, {
      clientUserId: session.user.clientUserId,
    }),
    getPortalClientName(session.firmId, session.user.clientId),
    portalSubjects(getServiceDbForFirm(session.firmId), session.user.clientId),
  ]);
  if (!data) notFound();

  return (
    <>
      <PortalHeader clientName={clientName ?? session.user.clientId} subjects={subjects} />
      <PortalMatterDetailView data={data} basePath="/portal" signerName={session.user.name} />
      <PortalFooter />
    </>
  );
}
