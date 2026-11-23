import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import LibraryPage from '@/components/library/LibraryPage';
import { showsDistilled } from '@/lib/library/scope';

export const metadata: Metadata = { title: 'Library' };

export default async function DashboardLibraryRoute() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const role = session.user.role ?? 'lawyer';

  return (
    <>
      <LibraryPage role={role} showDistilled={await showsDistilled(session.firmId)} />
    </>
  );
}
