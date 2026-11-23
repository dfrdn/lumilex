import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPortalSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import PortalHeader from '../PortalHeader';
import PortalFooter from '../PortalFooter';
import PortalBillingView from './PortalBillingView';
import { loadPortalBilling, getPortalClientName } from '@/lib/portal/data';
import { portalSubjects } from '@/lib/portal/companies';

export const metadata: Metadata = { title: 'Billing' };

export const dynamic = 'force-dynamic';

export default async function PortalBillingPage() {
  const session = await getPortalSession();
  if (!session) redirect('/portal/login');

  // Only this client's billed invoices, their payments, and the client's own
  // deposit ledger — the loader scopes to the session's client.
  const db = getServiceDbForFirm(session.firmId);
  const [{ invoices, payments, deposits }, clientName, subjects] = await Promise.all([
    loadPortalBilling(db, session.user.clientId),
    getPortalClientName(session.firmId, session.user.clientId),
    portalSubjects(db, session.user.clientId),
  ]);

  return (
    <>
      <PortalHeader clientName={clientName ?? session.user.clientId} subjects={subjects} />
      <PortalBillingView invoices={invoices} payments={payments} deposits={deposits} />
      <PortalFooter />
    </>
  );
}
