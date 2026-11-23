import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import ReimbursementsList from '@/components/finance/ReimbursementsList';

export const metadata: Metadata = { title: 'Reimbursements' };

export const revalidate = 30;

export default async function ReimbursementsPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <ReimbursementsList />
  );
}
