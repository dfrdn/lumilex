import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { UserPlus } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import ProspectsKanban from '@/app/dashboard/prospects/ProspectsKanban';

export const metadata: Metadata = { title: 'Prospects' };

export const revalidate = 0;

export default async function AdminProspectsPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <>
      <PageHeader icon={<UserPlus className="w-5 h-5" />} title="Prospects" subtitle="Client intake pipeline" />
      <ProspectsKanban />
    </>
  );
}
