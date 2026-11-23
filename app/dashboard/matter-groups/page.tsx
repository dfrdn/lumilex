import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { FolderKanban } from 'lucide-react';
import { getAllMatterGroups } from '@/lib/queries/matter-groups';
import PageHeader from '@/components/ui/PageHeader';
import MatterGroupsTable from './MatterGroupsTable';

export const metadata: Metadata = { title: 'Matter Groups' };

export const revalidate = 30;

export default async function MatterGroupsPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const role = session.user.role ?? 'lawyer';
  const userName = session.user.name ?? '';
  const groups = await getAllMatterGroups(session.firmId);

  return (
    <>
      <PageHeader
        icon={<FolderKanban className="w-5 h-5" />}
        title="Matter Groups"
        subtitle="Connected matters — preliminary investigations, cases, and appeals that belong together"
      />
      <MatterGroupsTable data={groups} role={role} />
    </>
  );
}
