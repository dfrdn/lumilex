import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import OperatingExpenses from '@/components/finance/OperatingExpenses';

export const metadata: Metadata = { title: 'Operating Expenses' };

export const revalidate = 0;

export default async function OperatingExpensesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <OperatingExpenses />
  );
}
