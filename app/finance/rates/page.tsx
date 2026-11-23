import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import RatesTable from '@/components/finance/RatesTable';

export const metadata: Metadata = { title: 'Rates' };

export const revalidate = 30;

export default async function RatesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <RatesTable />
  );
}
