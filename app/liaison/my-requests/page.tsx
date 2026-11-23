import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import MySubmissionsClient from '@/app/dashboard/my-submissions/MySubmissionsClient';

export const metadata: Metadata = { title: 'My Requests' };

export const revalidate = 30;

export default async function LiaisonMyRequestsPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <MySubmissionsClient actions={['leave', 'reimbursement', 'feedback']} />
  );
}
