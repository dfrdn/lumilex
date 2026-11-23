import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { Briefcase } from 'lucide-react';
import { getPartnerMattersView } from '@/lib/queries/partner-matters';
import { readsEveryMatter } from '@/lib/auth/matter-access';
import PageHeader from '@/components/ui/PageHeader';
import { getOpenBreachesForMatters } from '@/lib/queries/sla-breaches';
import { manilaToday } from '@/lib/dates';
import MyMattersTable from './MyMattersTable';
import SlaBreachesWidget from '@/components/SlaBreachesWidget';

export const metadata: Metadata = { title: 'My Matters' };

export const revalidate = 30;

export default async function MyMattersPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  const userId = session.user.notionUserId;
  // A relationship partner also sees their clients' other matters — only
  // when their role already reads every matter, so the list never widens access.
  const mattersRead = getPartnerMattersView(session.firmId, userId, {
    relationshipClients: readsEveryMatter(session.user.role),
  });
  const [matters, breaches] = await Promise.all([
    mattersRead,
    getOpenBreachesForMatters(session.firmId, mattersRead.then((ms) => ms.map((m) => m.id))),
  ]);

  return (
    <>
      <PageHeader
        icon={<Briefcase className="w-5 h-5" />}
        title="My Matters"
        subtitle={
          matters.some((m) => m.isRelationshipPartner)
            ? 'Your assigned matters, plus every matter of the clients you are relationship partner for'
            : 'Your assigned matters with personal notes and urgency tracking'
        }
      />
      <SlaBreachesWidget breaches={breaches} limit={5} />
      <MyMattersTable data={matters} currentUserId={userId} today={manilaToday()} />
    </>
  );
}
