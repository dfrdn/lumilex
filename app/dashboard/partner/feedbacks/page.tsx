import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import { MessageSquare } from 'lucide-react';

import FeedbackReviewClient from './FeedbackReviewClient';

export const metadata: Metadata = { title: 'Feedbacks' };

export const revalidate = 30;

export default async function PartnerFeedbacksPage() {
  const session = await requireRouteAccess('/dashboard/partner/feedbacks');
  const role = session.user.role ?? 'lawyer';

  return (
    <>
      <div className="mb-6 animate-fade-up">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center ring-1 ring-violet-200/60 dark:ring-violet-500/20">
            <MessageSquare className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold text-foreground">Feedbacks</h1>
            <p className="text-sm text-[var(--text-muted)]">Review and respond to team feedback</p>
          </div>
        </div>
      </div>

      <FeedbackReviewClient />
    </>
  );
}
