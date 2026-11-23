import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ScanSearch } from 'lucide-react';

import { getSession } from '@/lib/session';
import { isFeatureAvailable } from '@/lib/firm/features';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import PageHeader from '@/components/ui/PageHeader';
import AffidavitReviewClient, { type ReviewMatter } from './AffidavitReviewClient';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

export const metadata: Metadata = { title: 'Affidavit Review' };

export const dynamic = 'force-dynamic';

export default async function AffidavitReviewPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  if (!(await isFeatureAvailable(session.firmId, 'ai_analysis'))) redirect('/dashboard');


  // Service-role: show ALL active (non-archived) matters in the picker — it
  // only tags/filters the review. The JA-deliverable picker and the review
  // itself remain RLS-gated, so access to actual documents is unchanged.
  const supabase = getServiceDbForFirm(session.firmId);
  const { data: matters } = await supabase
    .from('matters')
    .select('notion_id, name, case_title, matter_code, created_time')
    // `matters.date` is NULL firm-wide; ordering by it left the list unsorted.
    .order('created_time', { ascending: false, nullsFirst: false })
    .neq('status', DELIVERABLE_STATUS.ARCHIVED)
    .limit(1000);

  const rows: ReviewMatter[] = (matters ?? []).map((m) => ({
    id: m.notion_id,
    // Known and searched by name; case_title is the verbose cause of action.
    name: m.name || m.case_title || 'Untitled matter',
    code: m.matter_code,
  }));

  return (
    <>
      <PageHeader
        icon={<ScanSearch className="w-5 h-5" />}
        title="Affidavit Review"
        subtitle="Check a judicial affidavit's questions for objectionable form or substance under the Judicial Affidavit Rule (A.M. No. 12-8-8-SC) and the 2019 Revised Rules on Evidence — to clean up our own before filing, or to build objections to the other side's."
      />
      <AffidavitReviewClient matters={rows} />
    </>
  );
}
