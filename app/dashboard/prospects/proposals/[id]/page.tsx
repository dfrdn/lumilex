import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { requireRouteAccess } from '@/lib/nav/guard';
import ProposalBuilder from '@/components/prospects/ProposalBuilder';

export const metadata: Metadata = { title: 'Engagement Proposal' };

export const revalidate = 0;

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProposalEditorPage({ params }: Props) {
  const { id } = await params;
  await requireRouteAccess(`/dashboard/prospects/proposals/${id}`);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/prospects/proposals"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
          Back to Engagement Proposals
        </Link>
      </div>
      <ProposalBuilder proposalId={id} />
    </>
  );
}
