import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import IntakeDetailView from '@/components/prospects/IntakeDetailView';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Prospect' };

export const revalidate = 0;

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminProspectDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  const intakeId = parseInt(id, 10);

  if (isNaN(intakeId)) redirect('/admin/prospects');

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/prospects"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
          Back to Prospects
        </Link>
      </div>
      <IntakeDetailView intakeId={intakeId} canEdit={true} />
    </>
  );
}
