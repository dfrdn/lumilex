import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import DocumentGenerator from '@/components/documents/DocumentGenerator';

export const metadata: Metadata = { title: 'Documents' };

export const revalidate = 30;

export default async function DocumentsPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const userName = session.user.name ?? '';
  const userImage = session.user.image;
  const role = session.user.role ?? 'lawyer';

  return (
    <>
      <DocumentGenerator />
    </>
  );
}
