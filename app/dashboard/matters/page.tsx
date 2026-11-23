import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { Scale } from 'lucide-react';
import { getAllMatters } from '@/lib/queries/listing';
import PageHeader from '@/components/ui/PageHeader';
import MattersTable from './MattersTable';

export const metadata: Metadata = { title: 'Matters' };

export const revalidate = 30;

export default async function MattersPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const userId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';
  const userName = session.user.name ?? '';
  const matters = await getAllMatters(session.firmId);

  return (
    <>
      <PageHeader icon={<Scale className="w-5 h-5" />} title="All Matters" subtitle="Browse all matters in the firm" />
      <MattersTable data={matters} userId={userId} role={role} />
    </>
  );
}
