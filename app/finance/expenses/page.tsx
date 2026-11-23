import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import FirmExpenses from '@/components/finance/FirmExpenses';

export const metadata: Metadata = { title: 'Matter Expenses' };

export const revalidate = 30;

export default async function ExpensesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <FirmExpenses />
  );
}
