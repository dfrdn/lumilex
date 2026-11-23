import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import ReceivablesAging from '@/components/finance/ReceivablesAging';
import { loadOutboundIdentity } from '@/lib/firm/outbound-identity';

export const metadata: Metadata = { title: 'Receivables' };

export const revalidate = 30;

export default async function ReceivablesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  const role = session.user.role ?? 'finance';
  const userImage = session.user.image ?? null;
  const { financeAddress } = await loadOutboundIdentity(session.firmId);

  return (
    <>
      <ReceivablesAging role={role} financeAddress={financeAddress} />
    </>
  );
}
