import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import { Calendar } from 'lucide-react';

import LeaveReviewClient from './LeaveReviewClient';

export const metadata: Metadata = { title: 'Leave Requests' };

export const revalidate = 30;

export default async function PartnerLeavesPage() {
  const session = await requireRouteAccess('/dashboard/partner/leaves');

  return (
    <>
      <div className="mb-6 animate-fade-up">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center ring-1 ring-emerald-200/60 dark:ring-emerald-500/20">
            <Calendar className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold text-foreground">Leave Requests</h1>
            <p className="text-sm text-[var(--text-muted)]">Review and manage team leave applications</p>
          </div>
        </div>
      </div>

      <LeaveReviewClient currentUserName={session.user.name ?? ''} />
    </>
  );
}
