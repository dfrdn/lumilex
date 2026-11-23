import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, ListChecks, UserPlus } from 'lucide-react';
import { requireRouteAccess } from '@/lib/nav/guard';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import PageHeader from '@/components/ui/PageHeader';
import ProposalsTable, { type ProposalListRow } from './ProposalsTable';
import NewProposalLauncher from '@/components/prospects/NewProposalLauncher';
import type { EngagementProposalRow } from '@/lib/engagement-proposal/types';

export const metadata: Metadata = { title: 'Engagement Proposals' };

export const revalidate = 0; // proposals change while a partner is drafting

const PIPELINE_ROLES = ['partner', 'admin', 'super_user'];

// engagement_proposals has no direct FK to clients — a prospect's name comes
// through the intake, and a proposal raised against an existing client has no
// intake at all. Falling back to the name stored on the proposal keeps a row
// readable in either case, and even if the intake or client was later removed.
type Row = EngagementProposalRow & {
  client_intakes?: { clients?: { name: string } | null } | null;
};

export default async function EngagementProposalsPage() {
  const session = await requireRouteAccess('/dashboard/prospects/proposals');

  const role = session.user.role ?? 'lawyer';

  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('engagement_proposals')
    .select('*, client_intakes(clients(name))')
    .order('updated_at', { ascending: false })
    .returns<Row[]>();

  const proposals = data ?? [];

  // "Latest" is per thread — one chain of drafts for one proposed engagement.
  // Superseded versions stay on the record deliberately, and a second, separate
  // engagement with the same client is its own thread rather than a later
  // version of the first.
  const highestVersion = new Map<string, number>();
  for (const p of proposals) {
    highestVersion.set(p.thread_id, Math.max(highestVersion.get(p.thread_id) ?? 0, p.version));
  }

  const rows: ProposalListRow[] = proposals.map((p) => ({
    id: p.id,
    intakeId: p.intake_id,
    version: p.version,
    status: p.status,
    clientName: p.client_intakes?.clients?.name || p.content?.client?.name || 'Unnamed client',
    subject: p.content?.subject ?? '',
    arrangement: p.content?.quote?.arrangement ?? null,
    tierLabel: p.content?.quote?.tierLabel ?? null,
    monthlyFee: p.content?.quote?.monthlyFee ?? null,
    isLatest: highestVersion.get(p.thread_id) === p.version,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));

  return (
    <>
      <PageHeader
        icon={<FileText className="w-5 h-5" />}
        title="Engagement Proposals"
        subtitle="Every proposal the firm has drafted, to prospects and to existing clients"
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <NewProposalLauncher />
        <Link
          href="/dashboard/prospects"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Prospect pipeline
        </Link>
        <Link
          href="/dashboard/prospects/scope-library"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 transition-colors"
        >
          <ListChecks className="w-3.5 h-3.5" />
          Scope library
        </Link>
      </div>
      <ProposalsTable rows={rows} />
    </>
  );
}
