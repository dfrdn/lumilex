import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Swords } from 'lucide-react';

import { getSession } from '@/lib/session';
import { isFeatureAvailable } from '@/lib/firm/features';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import PageHeader from '@/components/ui/PageHeader';
import RedTeamClient, { type RedTeamMatter } from './RedTeamClient';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

export const metadata: Metadata = { title: 'Red Team' };

export const dynamic = 'force-dynamic';

export default async function RedTeamPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const role = session.user.role ?? 'lawyer';
  if (!(await isFeatureAvailable(session.firmId, 'red_team'))) redirect('/dashboard');

  // RLS-scoped, unlike the Affidavit Review picker: there the matter is only a
  // label, but here it drives a service-role read of the matter brief and the
  // matter's own documents into the analysis prompt. Offering a matter the user
  // cannot open would be offering them its contents.
  const supabase = await getSupabaseServerAuthClient();
  const { data: matters } = await supabase
    .from('matters')
    .select('notion_id, name, case_title, matter_code, created_time')
    // `matters.date` is NULL firm-wide, so ordering by it left the picker in
    // whatever order Postgres returned.
    .order('created_time', { ascending: false, nullsFirst: false })
    .neq('status', DELIVERABLE_STATUS.ARCHIVED)
    .limit(1000);

  const rows: RedTeamMatter[] = (matters ?? []).map((m) => ({
    id: m.notion_id,
    // The matter's name ("People v. Dela Cruz") is what it is known and searched by.
    // case_title holds the verbose cause of action — leading with it made half
    // the list unfindable by the name the lawyer actually types, so it is kept
    // as a search keyword only.
    name: m.name || m.case_title || 'Untitled matter',
    caseTitle: m.case_title,
    code: m.matter_code,
  }));

  return (
    <>
      <PageHeader
        icon={<Swords className="w-5 h-5" />}
        title="Red Team"
        subtitle="Argue against our own pleading before opposing counsel does. Reads the draft against the matter's record, searches juris.ph for authority that defeats it, checks that every case we cite actually holds what we say, and ranks what would really be used against us. Point it at their filing instead and the findings become our attack plan."
      />
      <RedTeamClient matters={rows} />
    </>
  );
}
