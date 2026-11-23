import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import MySubmissionsClient from './MySubmissionsClient';

export const metadata: Metadata = { title: 'My Requests' };

export const revalidate = 30;

export default async function MySubmissionsPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <MySubmissionsClient />
  );
}
