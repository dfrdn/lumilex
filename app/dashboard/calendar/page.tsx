import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import { Calendar } from 'lucide-react';
import DashboardCalendarPage from '@/components/dashboard/DashboardCalendarPage';
import PageHeader from '@/components/ui/PageHeader';
import { getHearings, getMeetings } from '@/lib/queries/listing';
import { holdsUndated, opensOnUpcoming, parseCalendarTab, parseListWindow, windowKey, type ListWindow } from '@/lib/calendar/views';
import { formatDate } from '@/lib/format-date';
import CalendarTabs from './CalendarTabs';
import ListWindowBar from './ListWindowBar';
import HearingsTable from './HearingsTable';
import MeetingsTable from './MeetingsTable';

export const metadata: Metadata = { title: 'Calendar' };

function describeWindow(noun: string, w: ListWindow): string {
  if (w.from && w.to) return `${noun} from ${formatDate(w.from)} to ${formatDate(w.to)}`;
  if (w.to) return `${noun} up to ${formatDate(w.to)}`;
  if (w.from) return `${noun} from ${formatDate(w.from)} on${holdsUndated(w) ? ', and those with no date yet' : ''}`;
  return `${noun} on every date, and those with no date yet`;
}

/*
 * The month calendar, with the Hearings and Meetings lists as tabs
 * (?tab=, lib/calendar/views). The lists read a date window, by default from
 * 90 days back on; their old pages redirect here.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; card?: string; range?: string; from?: string; to?: string }>;
}) {
  const session = await requireRouteAccess('/dashboard/calendar');

  const params = await searchParams;
  const tab = parseCalendarTab(params.tab);
  if (tab === 'calendar') return <DashboardCalendarPage tabs={<CalendarTabs tab={tab} />} />;

  const userId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';
  const win = parseListWindow(params);
  const card = params.card ?? null;

  const upcomingOnly = opensOnUpcoming(win);
  const key = windowKey(win);
  const body =
    tab === 'hearings' ? (
      <HearingsTable key={key} initialCard={card} upcomingOnly={upcomingOnly} data={await getHearings(session.firmId, win)} userId={userId} role={role} />
    ) : (
      <MeetingsTable key={key} initialCard={card} upcomingOnly={upcomingOnly} data={await getMeetings(session.firmId, win)} userId={userId} role={role} />
    );

  return (
    <>
      <PageHeader
        icon={<Calendar className="w-5 h-5" />}
        title="Firm Calendar"
        subtitle={describeWindow(tab === 'hearings' ? 'Hearings' : 'Meetings', win)}
      />
      <div className="mb-4">
        <CalendarTabs tab={tab} />
      </div>
      <ListWindowBar tab={tab} win={win} />
      {body}
    </>
  );
}
