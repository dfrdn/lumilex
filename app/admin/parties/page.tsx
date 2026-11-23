import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { Shield } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import AdminPartiesManager from '@/components/admin/AdminPartiesManager';

export const metadata: Metadata = { title: 'Parties' };

export const revalidate = 0;

export default async function AdminPartiesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <>
      <PageHeader icon={<Shield className="w-5 h-5" />} title="Parties" subtitle="Manage parties across matters" />
      <AdminPartiesManager />
    </>
  );
}
