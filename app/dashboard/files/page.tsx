import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { Paperclip } from 'lucide-react';
import { getAllFiles, getUserMatterIds } from '@/lib/queries/listing';
import PageHeader from '@/components/ui/PageHeader';
import FilesTable from './FilesTable';

export const metadata: Metadata = { title: 'Files' };

export const revalidate = 30;

export default async function FilesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const userId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';
  const userName = session.user.name ?? '';

  const [files, userMatterIds] = await Promise.all([
    getAllFiles(session.firmId),
    getUserMatterIds(session.firmId, userId),
  ]);

  return (
    <>
      <PageHeader
        icon={<Paperclip className="w-5 h-5" />}
        title="Files"
        subtitle="Everything received on a matter: court issuances, client documents, and correspondence. Filter by type, origin, or when it arrived. Finalized work product lives under Deliverables."
      />
      <FilesTable data={files} userId={userId} userMatterIds={userMatterIds} role={role} />
    </>
  );
}
