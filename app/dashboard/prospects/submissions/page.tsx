import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import { Inbox } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import SubmissionsClient, { type SubmissionRow } from './SubmissionsClient';

export const metadata: Metadata = { title: 'Intake Submissions' };

export const revalidate = 0;

export default async function IntakeSubmissionsPage() {
  await requireRouteAccess('/dashboard/prospects/submissions');

  const supabase = await getSupabaseServerAuthClient();
  const { data: submissions } = await supabase
    .from('intake_submissions')
    .select('*')
    .in('status', ['new', 'in_review'])
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader
        icon={<Inbox className="w-5 h-5" />}
        title="Public Intake Submissions"
        subtitle="Inquiries from the public intake form. Run the conflict check, then convert legitimate inquiries into the prospects pipeline."
      />
      <SubmissionsClient initialSubmissions={(submissions ?? []) as SubmissionRow[]} />
    </>
  );
}
