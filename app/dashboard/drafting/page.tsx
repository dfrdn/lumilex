import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { isFeatureAvailable } from '@/lib/firm/features';
import { redirect } from 'next/navigation';
import { PenTool } from 'lucide-react';

import PageHeader from '@/components/ui/PageHeader';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import DraftingStudioClient, { type DraftingMatter } from './DraftingStudioClient';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

export const metadata: Metadata = { title: 'Drafting Studio' };

export const dynamic = 'force-dynamic';

export default async function DraftingStudioPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const role = session.user.role ?? 'lawyer';
  if (!(await isFeatureAvailable(session.firmId, 'drafting'))) redirect('/dashboard');

  // RLS scopes matters to those the caller can access.
  const supabase = await getSupabaseServerAuthClient();
  const [{ data: matters }, { data: lawyers }] = await Promise.all([
    supabase
      .from('matters')
      .select('notion_id, name, case_title, matter_code, type, status')
      .neq('status', DELIVERABLE_STATUS.ARCHIVED)
      // `date` is unpopulated firm-wide; order by the row's creation time so the
      // picker is deterministic (newest first) instead of arbitrary.
      .order('created_time', { ascending: false, nullsFirst: false })
      .limit(1000),
    // Reviewer options — same roles the assignment pickers use.
    supabase
      .from('team')
      .select('person_id, name')
      .in('role', ['lawyer', 'partner', 'super_user'])
      .eq('active', true)
      .order('name'),
  ]);

  const rows: DraftingMatter[] = (matters ?? []).map((m) => ({
    id: m.notion_id,
    // Display the matter's name (e.g. "People v. Dela Cruz"), consistent with the
    // rest of the app; case_title holds the verbose cause of action and is kept
    // only as a search keyword.
    name: m.name || m.case_title || 'Untitled matter',
    caseTitle: m.case_title,
    code: m.matter_code,
    type: m.type,
  }));

  const lawyerOptions = (lawyers ?? [])
    .filter((l) => l.person_id)
    .map((l) => ({ id: l.person_id as string, name: l.name ?? l.person_id }));

  return (
    <>
      <PageHeader
        icon={<PenTool className="w-5 h-5" />}
        title="Drafting Studio"
        subtitle="Draft a document grounded in the matter's facts, the firm's own prior filings, and our knowledge base — in the firm's house style, ready for review."
      />
      <DraftingStudioClient
        matters={rows}
        lawyers={lawyerOptions}
        currentUserId={session.user.notionUserId}
        signerName={session.user.name ?? ''}
      />
    </>
  );
}
