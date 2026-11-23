import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import { Suspense } from 'react';
import { getOpenTasks } from '@/lib/queries/tasks';
import { getFirmMeetingsThisWeek } from '@/lib/queries/meetings';
import { getHearingsThisWeek } from '@/lib/queries/hearings';
import { getFilingsThisWeek } from '@/lib/queries/filings';
import { getTeamDeliverables } from '@/lib/queries/deliverables';
import { getUserOverview } from '@/lib/queries/overview';
import Link from 'next/link';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { deliverableSlices, involving, onManilaDay, taskSlices } from '@/lib/dashboard-slices';
import { resolveLayout, visibleWidgets, type WidgetId } from '@/lib/dashboard-widgets';
import { myDate, stepOf } from '@/lib/my-deliverables';
import { getAwaitingClientSince, getCourtMatterIds, LOAD_DAYS, type LoadItem } from '@/lib/queries/dashboard';

import { addDays, manilaHour, todayISO, thisWeekRange } from '@/lib/dates';
import { STATUS_COLORS, DEFAULT_STATUS_COLOR, groupByStatus } from '@/lib/deliverable-status';
import { AlertTriangle, Building, CalendarRange, Clock, FileText, Hourglass } from 'lucide-react';
import DashboardRecentFiles, { DashboardRecentFilesSkeleton } from '@/components/DashboardRecentFiles';
import SectionCard from '@/components/ui/SectionCard';
import LoadError from '@/components/ui/LoadError';
import DeliverableTabs from '@/components/DeliverableTabs';
import DashboardMyTasks from '@/components/DashboardMyTasks';
import QuickActions from '@/components/QuickActions';
import DashboardBoard from '@/components/dashboard/DashboardBoard';
import NeedsAttention from '@/components/dashboard/NeedsAttention';
import MyDeliverables from '@/components/dashboard/MyDeliverables';
import TodaySchedule from '@/components/dashboard/TodaySchedule';
import CalendarWidget from '@/components/dashboard/CalendarWidget';
import Deadlines from '@/components/dashboard/Deadlines';
import TwoWeeks from '@/components/dashboard/TwoWeeks';
import UpNext from '@/components/dashboard/UpNext';
import WhatsNew from '@/components/dashboard/WhatsNew';
import MyTime from '@/components/dashboard/MyTime';
import FirmGlance from '@/components/dashboard/FirmGlance';
import WidgetSkeleton from '@/components/dashboard/WidgetSkeleton';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const session = await requireRouteAccess('/dashboard');

  const userId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';

  const userName = session.user.name ?? '';
  const db = await getSupabaseServerAuthClient();

  // The person's widgets, in their order (lib/dashboard-widgets.ts). Only the
  // widgets they show are read for: a hidden one costs nothing.
  const { data: prefs, error: prefsError } = await db
    .from('user_preferences')
    .select('dashboard_layout')
    .eq('email', (session.user.email ?? '').toLowerCase().trim())
    .maybeSingle();
  if (prefsError) console.error(`[dashboard] layout read failed for ${userId}:`, prefsError);

  const firmId = session.firmId;
  const layout = resolveLayout(role, prefs?.dashboard_layout);
  const shown = new Set(visibleWidgets(layout));
  const needs = (...ids: WidgetId[]) => ids.some((id) => shown.has(id));

  // Each kind of item is read once, over the widest span shown — the firm's
  // week, every open task, every active deliverable the user is involved in —
  // and the narrower lists are cut from it (lib/dashboard-slices.ts). A failed
  // read is logged and its widgets say so: an empty list would read as "no
  // hearings today". The rest of the widgets load on their own, streamed.
  // The user's own records go through RLS; the firm's week is read firm-wide
  // on purpose (the calendar's Firm view shows every hearing and filing).
  const skip = Promise.resolve(null);
  const teamRead = needs('attention', 'mydeliverables', 'deliverables') ? getTeamDeliverables(firmId, userId, db) : skip;
  // Which of the person's deliverables are court work, and how long the ones
  // with the client have waited. They need only the deliverables, so they
  // follow that read instead of the whole batch. Either failing only drops
  // the extra detail; null when the deliverables themselves failed.
  const detailRead = teamRead.then(
    (team) =>
      Promise.allSettled([
        getCourtMatterIds((team ?? []).map((d) => d.matterId).filter((id): id is string => !!id), db),
        getAwaitingClientSince(
          (team ?? []).filter((d) => d.currentlyWith.includes(userId) && stepOf(d.status) === 'client').map((d) => d.id),
          db,
        ),
      ] as const),
    () => null,
  );
  const settled = await Promise.allSettled([
    needs('attention', 'calendar', 'tasks') ? getOpenTasks(firmId, userId, db) : skip,
    needs('today', 'calendar') ? getFirmMeetingsThisWeek(firmId) : skip,
    // Always: Up next looks for the person's next hearing today.
    getHearingsThisWeek(firmId),
    needs('today', 'calendar') ? getFilingsThisWeek(firmId) : skip,
    teamRead,
    getUserOverview(firmId, userId, userName, { countPending: false, db }),
  ] as const);
  const LABELS = ['open tasks', 'firm meetings', 'firm hearings', 'firm filings', 'involved deliverables', 'overview'];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[dashboard] ${LABELS[i]} failed for ${userId}:`, r.reason);
  });
  const loaded = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

  const openTasks = loaded(settled[0]);
  const firmMeetings = loaded(settled[1]);
  const firmHearings = loaded(settled[2]);
  const firmFilings = loaded(settled[3]);
  const teamDeliverables = loaded(settled[4]);
  const overview = loaded(settled[5]);

  const today = todayISO();
  const weekRange = thisWeekRange();

  const tasks = openTasks && taskSlices(openTasks, today, weekRange);
  const weekMeetings = firmMeetings && involving(firmMeetings, userId);
  const weekHearings = firmHearings && involving(firmHearings, userId);
  const weekFilings = firmFilings && involving(firmFilings, userId);
  const deliverables = teamDeliverables && deliverableSlices(teamDeliverables, userId, today);

  const weekTasks = tasks?.week ?? null;
  const todayMeetings = weekMeetings && onManilaDay(weekMeetings, today);
  const todayHearings = weekHearings && onManilaDay(weekHearings, today);
  const todayFilings = weekFilings && weekFilings.filter((f) => f.date === today);
  const allDeliverables = deliverables?.mine ?? null;
  const overdueDeliverables = deliverables?.overdue.map((d) => ({
    id: d.id,
    status: d.status,
    currentlyWith: d.currentlyWith,
    externalDueDate: d.externalDueDate,
    reviewerIds: d.reviewerIds,
    reviewDates: d.reviewDates,
  })) ?? null;
  const overdueTasks = openTasks && openTasks.filter((t) => t.dueDate && t.dueDate < today).length;

  const detail = await detailRead;
  const courtRead = detail?.[0];
  const waitingRead = detail?.[1];
  if (courtRead?.status === 'rejected') console.error(`[dashboard] court matters failed for ${userId}:`, courtRead.reason);
  if (waitingRead?.status === 'rejected') console.error(`[dashboard] awaiting-client dates failed for ${userId}:`, waitingRead.reason);
  const courtMatterIds = courtRead?.status === 'fulfilled' ? [...courtRead.value] : [];
  const waitingSince = waitingRead?.status === 'fulfilled' ? waitingRead.value : {};
  const withMe = (allDeliverables ?? []).map((d) => d.id).join(',');

  // The person's own deliverables on the two-week strip: what's on their desk, not with the client, dated in the window.
  const loadEnd = addDays(today, LOAD_DAYS - 1);
  const deliverableLoad: LoadItem[] = (allDeliverables ?? []).flatMap((d) => {
    const date = myDate(d, userId);
    if (!date || date < today || date > loadEnd || stepOf(d.status) === 'client') return [];
    return [{
      key: `deliverable:${d.id}`,
      date,
      label: d.name,
      context: d.client || d.matter,
      kind: 'deliverable' as const,
      href: `/dashboard/deliverables/${d.id}`,
      pane: { entity: 'deliverables', id: d.id },
    }];
  });

  // Greeting based on PH time
  const hour = manilaHour();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const displayName = session.user.nickname?.trim() || userName.split(' ')[0] || 'there';
  const now = new Date();
  const renderedAt = now.getTime();

  const pendingHref = shown.has('mydeliverables') ? '#my-deliverables' : shown.has('deliverables') ? '#deliverables' : '/dashboard/deliverables';
  const PendingLink = pendingHref.startsWith('#') ? 'a' : Link;

  const widget = (id: WidgetId): React.ReactNode => {
    switch (id) {
      case 'attention':
        return (
          <Suspense fallback={<WidgetSkeleton id="attention" title="Needs attention" icon={<AlertTriangle className="w-5 h-5" />} rows={1} />}>
            <NeedsAttention
              firmId={firmId}
              userId={userId}
              today={today}
              overdueDeliverables={overdueDeliverables}
              overdueTasks={overdueTasks}
              deadlinesInstead={shown.has('mydeliverables') ? { withMe } : null}
              links={{
                deliverables: shown.has('mydeliverables') ? '#my-deliverables' : '/dashboard/deliverables',
                tasks: shown.has('tasks') ? '#my-tasks' : '/dashboard/tasks',
                inbox: shown.has('inbox') ? '#inbox' : '/dashboard/files',
                deadlines: shown.has('deadlines') ? '#deadlines' : '/dashboard/cases',
              }}
            />
          </Suspense>
        );
      case 'mydeliverables':
        return (
          <MyDeliverables
            initialItems={teamDeliverables}
            userId={userId}
            today={today}
            courtMatterIds={courtMatterIds}
            waitingSince={waitingSince}
          />
        );
      case 'twoweeks':
        return (
          <Suspense fallback={<WidgetSkeleton id="twoweeks" title="Next two weeks" icon={<CalendarRange className="w-5 h-5" />} rows={2} />}>
            <TwoWeeks firmId={firmId} userId={userId} withMe={withMe} deliverables={deliverableLoad} />
          </Suspense>
        );
      case 'today':
        return <TodaySchedule meetings={todayMeetings} hearings={todayHearings} filings={todayFilings} now={renderedAt} />;
      case 'firm':
        return (
          <Suspense fallback={<WidgetSkeleton id="firm" title="Firm at a glance" icon={<Building className="w-5 h-5" />} rows={2} />}>
            <FirmGlance firmId={firmId} hearingsThisWeek={firmHearings?.length ?? null} />
          </Suspense>
        );
      case 'calendar':
        return (
          <CalendarWidget
            mine={weekMeetings && weekHearings && weekFilings && weekTasks
              ? { meetings: weekMeetings, hearings: weekHearings, filings: weekFilings, tasks: weekTasks }
              : null}
            firm={firmMeetings && firmHearings && firmFilings
              ? { meetings: firmMeetings, hearings: firmHearings, filings: firmFilings }
              : null}
            weekStart={weekRange.start}
          />
        );
      case 'deadlines':
        return (
          <Suspense fallback={<WidgetSkeleton id="deadlines" title="Deadlines" icon={<Hourglass className="w-5 h-5" />} />}>
            <Deadlines userId={userId} withMe={withMe} />
          </Suspense>
        );
      case 'inbox':
        return (
          <Suspense fallback={<DashboardRecentFilesSkeleton />}>
            <DashboardRecentFiles firmId={firmId} userId={userId} />
          </Suspense>
        );
      case 'tasks':
        return <DashboardMyTasks openTasks={openTasks} />;
      case 'time':
        return (
          <Suspense fallback={<WidgetSkeleton id="time" title="My time" icon={<Clock className="w-5 h-5" />} rows={2} />}>
            <MyTime userId={userId} userName={userName || null} />
          </Suspense>
        );
      case 'deliverables':
        return (
          <SectionCard id="deliverables" title="All deliverables" icon={<FileText className="w-5 h-5" />} count={allDeliverables?.length} collapsible defaultOpen={false}>
            {allDeliverables && teamDeliverables ? (
              <DeliverableTabs
                myGroups={groupByStatus(allDeliverables)}
                myCount={allDeliverables.length}
                teamGroups={groupByStatus(teamDeliverables)}
                teamCount={teamDeliverables.length}
                currentUserId={userId}
                statusColors={STATUS_COLORS}
                defaultStatusColor={DEFAULT_STATUS_COLOR}
              />
            ) : (
              <LoadError />
            )}
          </SectionCard>
        );
    }
  };

  const widgets: Partial<Record<WidgetId, React.ReactNode>> = {};
  for (const id of shown) widgets[id] = widget(id);


  return (
    <DashboardBoard
      role={role}
      initialLayout={layout}
      widgets={widgets}
      banner={
        <>
          <WhatsNew role={role} />
          <UpNext
            hearings={todayHearings ?? []}
            deliverables={teamDeliverables ?? []}
            courtMatterIds={courtMatterIds}
            userId={userId}
            today={today}
            renderedAt={renderedAt}
          />
        </>
      }
      header={
        <>
          {/* One line: the top of the page belongs to the work, and the date is already in the top bar. */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            {greeting}, {displayName}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] tabular-nums">
            <Link href="/dashboard/my-dtr" className="hover:text-[var(--text-primary)] max-sm:py-2.5">
              <span className="font-semibold text-[var(--text-primary)]">{overview ? Number(overview.totalHoursThisMonth.toFixed(1)) : '—'} h</span> this month
            </Link>
            <span aria-hidden="true"> · </span>
            <Link href="/dashboard/my-matters" className="hover:text-[var(--text-primary)] max-sm:py-2.5">
              <span className="font-semibold text-[var(--text-primary)]">{overview?.activeMatterCount ?? '—'}</span>{' '}
              active {overview?.activeMatterCount === 1 ? 'matter' : 'matters'}
            </Link>
            <span aria-hidden="true"> · </span>
            {/* On this page, a plain anchor: a collapsed card opens on the hashchange a client-side Link doesn't fire. */}
            <PendingLink href={pendingHref} className="hover:text-[var(--text-primary)] max-sm:py-2.5">
              <span className="font-semibold text-[var(--text-primary)]">{allDeliverables?.length ?? '—'}</span>{' '}
              pending {allDeliverables?.length === 1 ? 'deliverable' : 'deliverables'}
            </PendingLink>
          </p>
          </div>
        </>
      }
      toolbar={
        <>
          <QuickActions variant="menu" />
        </>
      }
    />
  );
}
