import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import LedgerView from '@/components/finance/LedgerView';

export const metadata: Metadata = { title: 'Ledger' };

export const revalidate = 0;

export default async function LedgerPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <LedgerView />
  );
}
