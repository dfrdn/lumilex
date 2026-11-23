import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import TransportationTariffEditor from '@/components/finance/TransportationTariffEditor';

export const metadata: Metadata = { title: 'Transportation Tariff' };

export const revalidate = 0;

export default async function TransportationTariffPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <TransportationTariffEditor />
  );
}
