import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import InvoiceList from '@/components/finance/InvoiceList';
import { loadOutboundIdentity } from '@/lib/firm/outbound-identity';

export const metadata: Metadata = { title: 'Invoices' };

export const revalidate = 30;

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const userName = session.user.name ?? '';
  const role = session.user.role ?? 'finance';
  const userImage = session.user.image ?? null;
  const { financeAddress } = await loadOutboundIdentity(session.firmId);

  return (
    <>
      <InvoiceList financeAddress={financeAddress} />
    </>
  );
}
