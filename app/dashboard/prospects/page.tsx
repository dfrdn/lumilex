import type { Metadata } from 'next';
import Link from 'next/link';

import { FileText, Inbox, ListChecks, UserPlus } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import ProspectsKanban from './ProspectsKanban';
import { requireRouteAccess } from '@/lib/nav/guard';

export const metadata: Metadata = { title: 'Prospects' };

export const revalidate = 0; // always fresh

export default async function ProspectsPage() {
  const session = await requireRouteAccess('/dashboard/prospects');

  const userName = session.user.name ?? '';

  // Pending public-form submissions awaiting review.
  const supabase = await getSupabaseServerAuthClient();
  const [{ count: pendingSubmissions }, { count: proposalDrafts }] = await Promise.all([
    supabase
      .from('intake_submissions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'in_review']),
    supabase
      .from('engagement_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft'),
  ]);

  return (
    <>
      <PageHeader icon={<UserPlus className="w-5 h-5" />} title="Prospects" subtitle="Client intake pipeline" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/dashboard/prospects/submissions"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 transition-colors"
        >
          <Inbox className="w-3.5 h-3.5" />
          Public intake submissions
          {(pendingSubmissions ?? 0) > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 text-[10px] font-semibold text-white bg-gold-500 rounded-full px-1.5">
              {pendingSubmissions}
            </span>
          )}
        </Link>
        <Link
          href="/dashboard/prospects/proposals"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 transition-colors"
        >
          <FileText className="w-3.5 h-3.5" />
          Engagement proposals
          {(proposalDrafts ?? 0) > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 text-[10px] font-semibold text-white bg-gold-500 rounded-full px-1.5">
              {proposalDrafts}
            </span>
          )}
        </Link>
        <Link
          href="/dashboard/prospects/scope-library"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 transition-colors"
        >
          <ListChecks className="w-3.5 h-3.5" />
          Scope library
        </Link>
      </div>
      <ProspectsKanban />
    </>
  );
}
