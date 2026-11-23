import { getOpenTasks } from '@/lib/queries/tasks';
import { getFirmMeetingsThisWeek } from '@/lib/queries/meetings';
import { getHearingsThisWeek } from '@/lib/queries/hearings';
import { getFilingsThisWeek } from '@/lib/queries/filings';
import {
  getTeamDeliverables,
  getDeliverablesTodayFirm,
  getActiveDeliverablesFirm,
  getBacklogsFirm,
} from '@/lib/queries/deliverables';
import { deliverableSlices, involving, onManilaDay, taskSlices } from '@/lib/dashboard-slices';
import { getNewInboxFiles, getReadInboxFiles, getRecentInboxFilesFirm } from '@/lib/queries/files';
import { getUserOverview } from '@/lib/queries/overview';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

import { todayISO, thisWeekRange } from '@/lib/dates';
import {
  STATUS_COLORS,
  DEFAULT_STATUS_COLOR,
  groupByStatus,
} from '@/lib/deliverable-status';
import {
  CheckSquare,
  Handshake,
  Scale,
  FileText,
  CalendarDays,
  AlertTriangle,
  FolderOpen,
  Clock,
  Briefcase,
  Zap,
  Eye,
  Inbox,
} from 'lucide-react';
import AdminEntityLinkInterceptor from '@/components/admin/AdminEntityLinkInterceptor';
import RecentFilesSection from '@/components/RecentFilesSection';
import WeeklyCalendar from '@/components/WeeklyCalendar';
import SectionCard from '@/components/ui/SectionCard';
import ItemRow from '@/components/ItemRow';
import EmptyState from '@/components/ui/EmptyState';
import DateChip from '@/components/DateChip';
import DeliverableBoard from '@/components/DeliverableBoard';
import LawyerSelector from '@/components/shared/LawyerSelector';

import type {
  NotionTask,
  NotionMeeting,
  NotionHearing,
  NotionFiling,
  NotionDeliverable,
  NotionFile,
} from '@/types/notion';

export type ShellMode = 'admin' | 'finance';

interface Props {
  shellMode: ShellMode;
  selectedLawyerId: string;
}

function BodyWrapper({
  shellMode,
  children,
}: {
  shellMode: ShellMode;
  children: React.ReactNode;
}) {
  if (shellMode === 'admin') {
    return <AdminEntityLinkInterceptor>{children}</AdminEntityLinkInterceptor>;
  }
  return <>{children}</>;
}

export default async function TeamDashboardContent({ shellMode, selectedLawyerId }: Props) {
  const session = await getSession();
  if (!session) return null;

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: lawyerRows } = await supabase
    .from('team')
    .select('person_id, name, position')
    .eq('active', true)
    .in('role', ['lawyer', 'partner', 'super_user'])
    .order('name', { ascending: true });
  const lawyers = (lawyerRows ?? []).map((r) => ({
    personId: r.person_id as string,
    name: r.name as string,
    position: (r.position as string) ?? '',
  }));

  const validLawyerId = lawyers.some((l) => l.personId === selectedLawyerId)
    ? selectedLawyerId
    : '';
  const isFirmView = !validLawyerId;
  const selectedLawyer = lawyers.find((l) => l.personId === validLawyerId) ?? null;
  const selectorValue = isFirmView ? 'firm' : validLawyerId;

  const today = todayISO();
  const weekRange = thisWeekRange();

  let todayDeliverables: NotionDeliverable[] = [];
  let allDeliverables: NotionDeliverable[] = [];
  let backlogs: NotionDeliverable[] = [];
  let todayTasks: NotionTask[] = [];
  let weekTasks: NotionTask[] = [];
  let todayMeetings: NotionMeeting[] = [];
  let weekMeetings: NotionMeeting[] = [];
  let todayHearings: NotionHearing[] = [];
  let weekHearings: NotionHearing[] = [];
  let todayFilings: NotionFiling[] = [];
  let weekFilings: NotionFiling[] = [];
  let newInbox: NotionFile[] = [];
  let readInbox: NotionFile[] = [];
  let firmRecentFiles: NotionFile[] = [];
  let overview: Awaited<ReturnType<typeof getUserOverview>> | null = null;

  if (isFirmView) {
    const [td, ad, bl, wm, wh, wf, rf] = await Promise.allSettled([
      getDeliverablesTodayFirm(session.firmId),
      getActiveDeliverablesFirm(session.firmId),
      getBacklogsFirm(session.firmId),
      getFirmMeetingsThisWeek(session.firmId),
      getHearingsThisWeek(session.firmId),
      getFilingsThisWeek(session.firmId),
      getRecentInboxFilesFirm(session.firmId),
    ]);
    todayDeliverables = td.status === 'fulfilled' ? td.value : [];
    allDeliverables = ad.status === 'fulfilled' ? ad.value : [];
    backlogs = bl.status === 'fulfilled' ? bl.value : [];
    weekMeetings = wm.status === 'fulfilled' ? wm.value : [];
    weekHearings = wh.status === 'fulfilled' ? wh.value : [];
    weekFilings = wf.status === 'fulfilled' ? wf.value : [];
    todayMeetings = onManilaDay(weekMeetings, today);
    todayHearings = onManilaDay(weekHearings, today);
    todayFilings = weekFilings.filter((f) => f.date === today);
    firmRecentFiles = rf.status === 'fulfilled' ? rf.value : [];
  } else {
    // The lawyer's own dashboard, read and cut the same way (app/dashboard/page.tsx).
    const userId = validLawyerId;
    const userName = selectedLawyer?.name ?? '';
    const [ot, fm, fh, ff, inv, ni, ri, ov] = await Promise.allSettled([
      getOpenTasks(session.firmId, userId),
      getFirmMeetingsThisWeek(session.firmId),
      getHearingsThisWeek(session.firmId),
      getFilingsThisWeek(session.firmId),
      getTeamDeliverables(session.firmId, userId),
      getNewInboxFiles(session.firmId, userId),
      getReadInboxFiles(session.firmId, userId),
      getUserOverview(session.firmId, userId, userName, { countPending: false }),
    ]);
    const tasks = taskSlices(ot.status === 'fulfilled' ? ot.value : [], today, weekRange);
    todayTasks = tasks.today;
    weekTasks = tasks.week;
    weekMeetings = involving(fm.status === 'fulfilled' ? fm.value : [], userId);
    weekHearings = involving(fh.status === 'fulfilled' ? fh.value : [], userId);
    weekFilings = involving(ff.status === 'fulfilled' ? ff.value : [], userId);
    todayMeetings = onManilaDay(weekMeetings, today);
    todayHearings = onManilaDay(weekHearings, today);
    todayFilings = weekFilings.filter((f) => f.date === today);
    const deliverables = deliverableSlices(inv.status === 'fulfilled' ? inv.value : [], userId, today);
    allDeliverables = deliverables.mine;
    todayDeliverables = deliverables.dueToday;
    backlogs = deliverables.overdue;
    newInbox = ni.status === 'fulfilled' ? ni.value : [];
    readInbox = ri.status === 'fulfilled' ? ri.value : [];
    overview = ov.status === 'fulfilled' ? ov.value : null;
  }

  const backlogGroups = groupByStatus(backlogs);
  const deliverableGroups = groupByStatus(allDeliverables);

  const headerTitle = isFirmView
    ? 'Firm-wide Schedule'
    : `${selectedLawyer?.name ?? ''}'s Dashboard`;
  const headerSubtitle = isFirmView
    ? "A read-only overview of the firm's activity."
    : `A read-only view of ${selectedLawyer?.name ?? 'this lawyer'}'s dashboard.`;

  const selectorBasePath =
    shellMode === 'admin' ? '/admin/team-dashboard' : '/finance/team-dashboard';

  return (
    <>
      <div className="mb-8 animate-fade-up">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-700 dark:text-gold-400 bg-gold-100/60 dark:bg-gold-400/10 rounded-full px-2 py-0.5">
                <Eye className="w-3 h-3" />
                Read-only
              </span>
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
              {headerTitle}
            </h1>
            <div className="greeting-accent mt-2" />
            <p className="text-sm text-[var(--text-secondary)] mt-2.5">
              {headerSubtitle}
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-3">
            <LawyerSelector
              lawyers={lawyers.map((l) => ({
                personId: l.personId,
                name: l.name,
                position: l.position,
              }))}
              selected={selectorValue}
              basePath={selectorBasePath}
            />
            {!isFirmView && overview && (
              <div className="flex items-stretch gap-3">
                <div className="bg-card rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] px-4 py-3 text-center min-w-[100px]">
                  <div className="flex items-center justify-center gap-1.5 mb-1.5">
                    <Clock className="w-3 h-3 text-gold-400/70" />
                    <p className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-[0.1em]">
                      Hours
                    </p>
                  </div>
                  <p className="text-lg font-bold text-foreground tabular-nums font-mono">
                    {overview.totalHoursThisMonth.toFixed(1)}
                  </p>
                </div>
                <div className="bg-card rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] px-4 py-3 text-center min-w-[100px]">
                  <div className="flex items-center justify-center gap-1.5 mb-1.5">
                    <Briefcase className="w-3 h-3 text-gold-400/70" />
                    <p className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-[0.1em]">
                      Matters
                    </p>
                  </div>
                  <p className="text-lg font-bold text-foreground tabular-nums font-mono">
                    {overview.activeMatterCount}
                  </p>
                </div>
                <div className="bg-card rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] px-4 py-3 text-center min-w-[100px]">
                  <div className="flex items-center justify-center gap-1.5 mb-1.5">
                    <Zap className="w-3 h-3 text-gold-400/70" />
                    <p className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-[0.1em]">
                      Pending
                    </p>
                  </div>
                  <p className="text-lg font-bold text-foreground tabular-nums font-mono">
                    {allDeliverables.length}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <BodyWrapper shellMode={shellMode}>
        <div className="mb-3">
          <h2 className="section-label font-serif text-base font-semibold text-foreground">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gold-400" />
              Today
            </span>
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <SectionCard
            title="Due Today"
            icon={<FileText className="w-5 h-5" />}
            count={todayDeliverables.length}
            className="border-l-4 border-l-gold-600"
          >
            {todayDeliverables.length === 0 ? (
              <EmptyState message="Nothing due today" />
            ) : (
              todayDeliverables.map((d) => (
                <ItemRow
                  key={d.id}
                  href={`/dashboard/deliverables/${d.id}`}
                  title={d.name}
                  subtitle={d.client || undefined}
                  meta={
                    <DateChip
                      date={
                        d.externalDueDate ??
                        (d.reviewDates.length > 0
                          ? d.reviewDates[d.reviewDates.length - 1]
                          : null)
                      }
                    />
                  }
                />
              ))
            )}
          </SectionCard>

          {!isFirmView && (
            <SectionCard
              title="Tasks"
              icon={<CheckSquare className="w-5 h-5" />}
              count={todayTasks.length}
              className="border-l-4 border-l-stone-400 dark:border-l-stone-600"
            >
              {todayTasks.length === 0 ? (
                <EmptyState message="No tasks today" />
              ) : (
                todayTasks.map((t) => (
                  <ItemRow
                    key={t.id}
                    href={`/dashboard/tasks/${t.id}`}
                    title={t.name}
                    subtitle={t.matter || undefined}
                  />
                ))
              )}
            </SectionCard>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <SectionCard
            title="Meetings"
            icon={<Handshake className="w-5 h-5" />}
            count={todayMeetings.length}
            className="border-l-4 border-l-gold-400"
          >
            {todayMeetings.length === 0 ? (
              <EmptyState message="No meetings today" />
            ) : (
              todayMeetings.map((m) => (
                <ItemRow
                  key={m.id}
                  href={`/dashboard/meetings/${m.id}`}
                  title={m.name}
                  subtitle={
                    m.date
                      ? new Date(m.date).toLocaleTimeString('en-PH', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Manila',
                        })
                      : undefined
                  }
                />
              ))
            )}
          </SectionCard>

          <SectionCard
            title="Hearings"
            icon={<Scale className="w-5 h-5" />}
            count={todayHearings.length}
            className="border-l-4 border-l-red-400 dark:border-l-red-500/70"
          >
            {todayHearings.length === 0 ? (
              <EmptyState message="No hearings today" />
            ) : (
              todayHearings.map((h) => (
                <ItemRow
                  key={h.id}
                  href={`/dashboard/hearings/${h.id}`}
                  title={h.name}
                  subtitle={
                    h.date
                      ? new Date(h.date).toLocaleTimeString('en-PH', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Manila',
                        })
                      : undefined
                  }
                />
              ))
            )}
          </SectionCard>

          <SectionCard
            title="Filings"
            icon={<FolderOpen className="w-5 h-5" />}
            count={todayFilings.length}
            className="border-l-4 border-l-teal-400 dark:border-l-teal-500/70"
          >
            {todayFilings.length === 0 ? (
              <EmptyState message="No filings today" />
            ) : (
              todayFilings.map((f) => (
                <ItemRow
                  key={f.id}
                  href={`/dashboard/deliverables/${f.id}`}
                  title={f.name}
                  subtitle={f.matter || undefined}
                />
              ))
            )}
          </SectionCard>
        </div>

        <div className="mb-10">
          <SectionCard
            title={isFirmView ? 'Firm Week' : 'Their Week'}
            icon={<CalendarDays className="w-5 h-5" />}
            count={
              weekMeetings.length +
              weekTasks.length +
              weekHearings.length +
              weekFilings.length
            }
          >
            <WeeklyCalendar
              key={isFirmView ? 'firm' : validLawyerId}
              initialMeetings={weekMeetings}
              initialHearings={weekHearings}
              initialFilings={weekFilings}
              initialTasks={isFirmView ? [] : weekTasks}
              initialWeekStart={weekRange.start}
              apiEndpoint={isFirmView ? '/api/firm-calendar' : `/api/team-calendar?userId=${encodeURIComponent(validLawyerId)}`}
            />
          </SectionCard>
        </div>

        {isFirmView ? (
          <div className="mb-6">
            <SectionCard
              title="Recent Files"
              icon={<Inbox className="w-5 h-5" />}
              count={firmRecentFiles.length}
              collapsible
              defaultOpen={false}
            >
              {firmRecentFiles.length === 0 ? (
                <EmptyState message="No recent files" />
              ) : (
                firmRecentFiles.map((f) => (
                  <ItemRow
                    key={f.id}
                    href={`/dashboard/files/${f.id}`}
                    title={f.name || '(Untitled)'}
                    subtitle={f.matter || undefined}
                    meta={<DateChip date={f.dateReceived ?? null} />}
                  />
                ))
              )}
            </SectionCard>
          </div>
        ) : (
          <div className="mb-6">
            <RecentFilesSection
              newFiles={newInbox}
              readFiles={readInbox}
              userId={validLawyerId}
            />
          </div>
        )}

        <div className="mb-6">
          <SectionCard
            title={isFirmView ? 'All Active Deliverables' : 'Deliverables'}
            icon={<FileText className="w-5 h-5" />}
            count={allDeliverables.length}
            collapsible
            defaultOpen={false}
          >
            {allDeliverables.length === 0 ? (
              <EmptyState message="No active deliverables" />
            ) : (
              <DeliverableBoard
                groups={deliverableGroups}
                statusColors={STATUS_COLORS}
                defaultStatusColor={DEFAULT_STATUS_COLOR}
                readOnly
              />
            )}
          </SectionCard>
        </div>

        <div className="mb-6">
          <SectionCard
            title="Overdue & Backlogs"
            icon={<AlertTriangle className="w-5 h-5" />}
            count={backlogs.length}
            collapsible
            defaultOpen={false}
            className={
              backlogs.length > 0
                ? 'border-l-4 border-l-gold-500 dark:border-l-gold-400'
                : ''
            }
          >
            {backlogs.length === 0 ? (
              <EmptyState message="No overdue items" />
            ) : (
              <DeliverableBoard
                groups={backlogGroups}
                statusColors={STATUS_COLORS}
                defaultStatusColor={DEFAULT_STATUS_COLOR}
                readOnly
              />
            )}
          </SectionCard>
        </div>
      </BodyWrapper>
    </>
  );
}
