import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { CalendarClock } from 'lucide-react';
import { getDeadlineDashboard } from '@/lib/queries/listing';
import PageHeader from '@/components/ui/PageHeader';
import DeadlinesView from './DeadlinesView';

export const metadata: Metadata = { title: 'Trademark Deadlines' };

export const revalidate = 30;

export default async function TrademarkDeadlinesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const role = session.user.role ?? 'lawyer';
  const userName = session.user.name ?? '';
  const deadlines = await getDeadlineDashboard(session.firmId);

  return (
    <>
      <PageHeader
        icon={<CalendarClock className="w-5 h-5" />}
        title="Trademark Deadlines"
        subtitle="Filings, OA responses, DAUs and renewals across every active mark — anything overdue, and everything due in the next 12 months"
      />
      <DeadlinesView deadlines={deadlines} />
    </>
  );
}
