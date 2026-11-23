import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import { redirect } from 'next/navigation';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import IntakeDetailView from '@/components/prospects/IntakeDetailView';

export const metadata: Metadata = { title: 'Prospect' };

export const revalidate = 0;

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProspectDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await requireRouteAccess(`/dashboard/prospects/${id}`);
  const role = session.user.role ?? 'lawyer';

  // Partners co-manage the intake pipeline alongside admins, so they
  // get the same edit/delete/stage controls on the detail view.
  const canEdit = role === 'partner' || role === 'admin' || role === 'super_user';
  const intakeId = parseInt(id, 10);

  if (isNaN(intakeId)) redirect('/dashboard/prospects');

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/prospects"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
          Back to Prospects
        </Link>
      </div>
      <IntakeDetailView intakeId={intakeId} canEdit={canEdit} />
    </>
  );
}
