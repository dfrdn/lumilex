import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import DTRReviewDashboard from '@/components/finance/DTRReviewDashboard';

export const metadata: Metadata = { title: 'Review & Generate' };

export const revalidate = 0;

export default async function DTRReviewPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <DTRReviewDashboard currentUserId={session.user.notionUserId} />
  );
}
