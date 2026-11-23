import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { addDays, manilaDayEnd, manilaDayStart, monthRange, toManilaDay, weekRange, type DayString } from '@/lib/dates';
import { toDecimal } from '@/lib/dtr-utils';
import { daysInSpan, daysWithoutTime, workWeek } from '@/lib/my-time';
import { getStaticHolidaysInRange } from '@/lib/legal/ph-holidays';
import { fetchAllRows, fetchAllRowsIn } from '@/lib/supabase-paginate';
import { dtrPersonFilter } from '@/lib/queries/my-dtr';
import { getCaseNeedsAction } from '@/lib/queries/cases';
import { getDTRAggregates, getLawyerProfiles, getLawyerUtilization } from '@/lib/queries/partner-analytics';
import { getHearingsForWeek } from '@/lib/queries/hearings';
import { DELIVERABLE_STATUS, HANDED_OFF_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';

/** Reads behind the dashboard widgets that have no list page of their own. */

// ── My deliverables ─────────────────────────────────────────────

/**
 * Which of these matters are court work: a case matter as Filings reads it
 * (case title, number or court set), or a matter handling a case in Cases.
 */
export async function getCourtMatterIds(matterIds: string[], db: SupabaseClient): Promise<Set<string>> {
  const ids = [...new Set(matterIds)];
  if (ids.length === 0) return new Set();
  const [onCase, linked] = await Promise.all([
    fetchAllRowsIn<{ notion_id: string }>(ids, (batch, from, to) =>
      db
        .from('matters')
        .select('notion_id')
        .in('notion_id', batch)
        .or('case_title.neq.,case_number.neq.,court.neq.')
        .order('notion_id')
        .range(from, to),
    ),
    fetchAllRowsIn<{ matter_id: string; subject_id: string }>(ids, (batch, from, to) =>
      db
        .from('matter_subjects')
        .select('matter_id, subject_id')
        .eq('scope', 'case')
        .in('matter_id', batch)
        .order('matter_id')
        .order('subject_id')
        .range(from, to),
    ),
  ]);
  return new Set([...onCase.map((m) => m.notion_id), ...linked.map((m) => m.matter_id)]);
}

/**
 * When each of these deliverables last went to Awaiting Client, from the
 * workflow log. Deliverables that predate the log have no entry.
 */
export async function getAwaitingClientSince(deliverableIds: string[], db: SupabaseClient): Promise<Record<string, string>> {
  if (deliverableIds.length === 0) return {};
  const rows = await fetchAllRowsIn<{ id: number; deliverable_id: string; created_at: string }>(deliverableIds, (batch, from, to) =>
    db
      .from('deliverable_actions')
      .select('id, deliverable_id, created_at')
      .eq('new_status', DELIVERABLE_STATUS.AWAITING_CLIENT)
      .in('deliverable_id', batch)
      .order('id')
      .range(from, to),
  );
  const since: Record<string, string> = {};
  for (const r of rows) if (!since[r.deliverable_id] || r.created_at > since[r.deliverable_id]) since[r.deliverable_id] = r.created_at;
  return since;
}

// ── Deadlines ───────────────────────────────────────────────────

export const DEADLINE_DAYS = 14;

export interface UpcomingDeadline {
  key: string;
  date: DayString;
  /** "Hearing", "Position paper", "GIS filing", "3-DAU". */
  label: string;
  /** What it is for: the case, company or mark. */
  context: string;
  kind: 'case' | 'company' | 'mark';
  href: string;
  /** The record the side pane opens, when there is one: a hearing, or the deliverable behind a filing or item. */
  pane: { entity: 'hearings' | 'deliverables'; id: string } | null;
}

export interface MyDeadlines {
  /** Past and still open: company and mark items, case filings and MR dates, hearings with no outcome recorded. */
  overdue: UpcomingDeadline[];
  /** Today through the next fortnight. */
  upcoming: UpcomingDeadline[];
}

interface StatusItemRow {
  subject_id: string;
  item_key: string;
  label: string;
  state: string;
  due_date: string;
  deliverable_id: string | null;
  subject: { type: string; name: string | null } | null;
}

/**
 * Deadlines on the person's cases, companies and marks: what is past and
 * still open, and the next fortnight. Case hearings, filings and MR dates
 * come from the Cases module; a company's or mark's items from its stored
 * status (`subject_status_items`), whose team is the team of the matters
 * covering it. Deliverables already with the person (`withMe`) are left
 * out: My deliverables lists them. A past item waiting on the client isn't
 * overdue on anyone here, as with deliverables.
 */
export async function getMyDeadlines(
  personId: string,
  today: DayString,
  db: SupabaseClient,
  withMe: ReadonlySet<string> = new Set(),
): Promise<MyDeadlines> {
  const until = addDays(today, DEADLINE_DAYS);

  const [cases, items] = await Promise.all([
    getCaseNeedsAction({ mine: personId }),
    fetchAllRows<StatusItemRow>((from, to) =>
      db
        .from('subject_status_items')
        .select('subject_id, item_key, label, state, due_date, deliverable_id, subject:subjects!inner(type, name)')
        .contains('team_person_ids', [personId])
        .lte('due_date', until)
        .order('due_date')
        .order('subject_id')
        .order('item_key')
        .range(from, to)
        .returns<StatusItemRow[]>(),
    ),
  ]);

  const overdue: UpcomingDeadline[] = [];
  const upcoming: UpcomingDeadline[] = [];

  for (const e of [...cases.hearings, ...cases.filings]) {
    if (e.kind === 'filing' && withMe.has(e.id)) continue;
    // A hearing's date is a timestamp, whose Manila day can differ from its UTC one.
    const date = e.kind === 'hearing' ? toManilaDay(e.date) : e.date.slice(0, 10);
    const unrecorded = e.kind === 'hearing' && e.outcome === 'unrecorded';
    const past = unrecorded || (e.kind !== 'hearing' && date < today);
    if (!past && (date < today || date > until || (e.kind === 'hearing' && e.outcome !== 'upcoming'))) continue;
    (past ? overdue : upcoming).push({
      key: `case:${e.kind}:${e.id}`,
      date,
      label: unrecorded ? 'Hearing — outcome not recorded' : e.kind === 'hearing' ? 'Hearing' : e.kind === 'mr' ? 'Motion for reconsideration due' : e.name,
      context: [e.caseTitle, e.forum].filter(Boolean).join(' · '),
      kind: 'case',
      href: `/dashboard/cases/${e.caseId}`,
      pane: e.kind === 'hearing' ? { entity: 'hearings', id: e.id } : e.kind === 'filing' ? { entity: 'deliverables', id: e.id } : null,
    });
  }

  for (const r of items) {
    const type = r.subject?.type;
    if (type !== 'corporation' && type !== 'trademark') continue;
    if (r.deliverable_id && withMe.has(r.deliverable_id)) continue;
    const past = r.due_date < today;
    if (past && r.state !== 'overdue') continue;
    (past ? overdue : upcoming).push({
      key: `subject:${r.subject_id}:${r.item_key}`,
      date: r.due_date,
      label: r.label,
      context: r.subject?.name ?? '',
      kind: type === 'corporation' ? 'company' : 'mark',
      href: type === 'corporation' ? `/dashboard/corporations/${r.subject_id}` : `/dashboard/trademarks/${r.subject_id}`,
      pane: r.deliverable_id ? { entity: 'deliverables', id: r.deliverable_id } : null,
    });
  }

  const byDate = (a: UpcomingDeadline, b: UpcomingDeadline) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label);
  // Overdue runs most recently missed first, as My deliverables does.
  return { overdue: overdue.sort((a, b) => byDate(b, a)), upcoming: upcoming.sort(byDate) };
}

/**
 * `getMyDeadlines` once per request: the Deadlines widget and the two-week
 * strip both read it. `withMe` comes as a joined string so the cache can key on it.
 */
export const getMyDeadlinesOnce = cache(async (personId: string, today: DayString, withMe: string) =>
  getMyDeadlines(personId, today, await getSupabaseServerAuthClient(), new Set(withMe ? withMe.split(',') : [])),
);

// ── Next two weeks ──────────────────────────────────────────────

export const LOAD_DAYS = 14;

export interface LoadItem {
  key: string;
  date: DayString;
  label: string;
  context: string;
  kind: 'deliverable' | 'hearing' | 'case' | 'company' | 'mark';
  href: string;
  pane: { entity: string; id: string } | null;
}

/**
 * What falls on each of the next two weeks' days outside My deliverables:
 * the person's hearings (as an attendee) and the deadlines on their cases,
 * companies and marks. The caller adds their deliverables, which it holds.
 */
export async function getLoadItems(firmId: string, personId: string, today: DayString, withMe: string): Promise<LoadItem[]> {
  const end = addDays(today, LOAD_DAYS - 1);
  const [hearings, deadlines] = await Promise.all([
    getHearingsForWeek(firmId, today, end, personId),
    getMyDeadlinesOnce(personId, today, withMe),
  ]);
  const items: LoadItem[] = hearings
    .filter((h) => h.date && h.status !== 'Cancelled')
    .map((h) => ({
      key: `hearing:${h.id}`,
      date: toManilaDay(h.date!),
      label: h.name,
      context: h.matter,
      kind: 'hearing' as const,
      href: `/dashboard/hearings/${h.id}`,
      pane: { entity: 'hearings', id: h.id },
    }));
  const hearingIds = new Set(hearings.map((h) => h.id));
  for (const d of deadlines.upcoming) {
    // A case hearing is already here from the person's own hearings.
    if (d.pane?.entity === 'hearings' && hearingIds.has(d.pane.id)) continue;
    if (d.date > end) continue;
    items.push({ key: d.key, date: d.date, label: d.label, context: d.context, kind: d.kind, href: d.href, pane: d.pane });
  }
  return items.filter((i) => i.date >= today && i.date <= end);
}

// ── My time ─────────────────────────────────────────────────────

export interface MyTime {
  weekDays: DayString[];
  hoursByDay: Record<DayString, number>;
  weekTotal: number;
  monthTotal: number;
  /** Past weekdays this week with nothing logged, leaving out holidays and the person's leave. */
  missing: DayString[];
}

/**
 * The person's hours this week, day by day, and this month — counted the way
 * My DTR counts them (their own entries and those they're listed "with").
 * There is no hours target: lawyers aren't given one, so none is shown.
 */
export async function getMyTime(
  personId: string,
  personName: string | null,
  week: { start: DayString; end: DayString },
  today: DayString,
  db: SupabaseClient,
): Promise<MyTime> {
  const month = monthRange();
  const from = week.start < month.start ? week.start : month.start;
  const to = week.end > month.end ? week.end : month.end;
  const days = workWeek(week.start);
  const friday = days[days.length - 1];

  const [dtr, leaves, holidays] = await Promise.all([
    fetchAllRows<{ notion_id: string; date: string | null; hours: number | null; minutes: number | null }>((f, t) =>
      db
        .from('dtr')
        .select('notion_id, date, hours, minutes')
        .or(dtrPersonFilter(personId, personName))
        .gte('date', from)
        .lte('date', to)
        .order('notion_id')
        .range(f, t),
    ),
    db
      .from('leaves')
      .select('period_start, period_end')
      .eq('person_id', personId)
      .not('status', 'in', '("Rejected","Cancelled")')
      .lte('period_start', friday)
      .gte('period_end', week.start),
    db.from('ph_holidays').select('date').gte('date', week.start).lte('date', friday),
  ]);
  if (leaves.error) throw leaves.error;
  if (holidays.error) throw holidays.error;

  const hoursByDay: Record<DayString, number> = {};
  let monthTotal = 0;
  for (const row of dtr) {
    if (!row.date) continue;
    const h = toDecimal(row.hours ?? 0, row.minutes ?? 0);
    if (row.date >= week.start && row.date <= week.end) hoursByDay[row.date] = (hoursByDay[row.date] ?? 0) + h;
    if (row.date >= month.start && row.date <= month.end) monthTotal += h;
  }

  const offDays = new Set<DayString>([
    ...getStaticHolidaysInRange(week.start, friday).map((h) => h.date),
    ...(holidays.data ?? []).map((h) => h.date as string),
    ...(leaves.data ?? []).flatMap((l) =>
      l.period_start ? daysInSpan(l.period_start, l.period_end ?? l.period_start, week.start, friday) : [],
    ),
  ]);

  return {
    weekDays: days,
    hoursByDay,
    weekTotal: Object.values(hoursByDay).reduce((s, h) => s + h, 0),
    monthTotal,
    missing: daysWithoutTime(week.start, today, hoursByDay, offDays),
  };
}

// ── Firm at a glance (partners) ─────────────────────────────────

export interface FirmGlance {
  monthHours: number;
  billedHours: number;
  /** Hours logged in the same days of last month (1st to today's date), for a like-for-like pace. */
  lastMonthHoursToDate: number;
  /** The firm average the partner dashboard shows, month to date. */
  utilization: number;
  /** The same average over the whole of last month. */
  lastMonthUtilization: number;
  overdueDeliverables: number;
  /** Overdue deliverables filed or sent out in the last `CLEARING_WINDOW_DAYS`. */
  overdueCleared: number;
  /** Deliverables that passed their due date undone in the same window. */
  newlyOverdue: number;
  hearingsNextWeek: number;
}

export const CLEARING_WINDOW_DAYS = 30;

/** The 1st of last month to the same date, cut at last month's end. */
function lastMonthToDate(monthStart: DayString, today: DayString): { start: DayString; end: DayString } {
  const prevEnd = addDays(monthStart, -1);
  const start = `${prevEnd.slice(0, 8)}01`;
  const sameDay = `${prevEnd.slice(0, 8)}${today.slice(8)}`;
  return { start, end: sameDay < prevEnd ? sameDay : prevEnd };
}

async function sumDtrHours(db: SupabaseClient, start: DayString, end: DayString): Promise<number> {
  const rows = await fetchAllRows<{ hours: number | null; minutes: number | null }>((from, to) =>
    db.from('dtr').select('hours, minutes').gte('date', start).lte('date', end).order('notion_id').range(from, to),
  );
  return rows.reduce((s, r) => s + toDecimal(r.hours ?? 0, r.minutes ?? 0), 0);
}

/** Hearings next week, counted as the dashboard's week of hearings is. */
async function countHearingsNextWeek(db: SupabaseClient): Promise<number> {
  const { start, end } = weekRange(7);
  const { count, error } = await db
    .from('hearings')
    .select('notion_id', { count: 'exact', head: true })
    .neq('type', 'Filing')
    .gte('date', manilaDayStart(start))
    .lte('date', manilaDayEnd(end));
  if (error) throw error;
  return count ?? 0;
}

/**
 * Statuses the Deliverables list's Overdue card leaves out — done, or waiting
 * on the client — so the tile's count is the list it links to. Status reports
 * are left out the same way.
 */
const NOT_OVERDUE = pgInList([...HANDED_OFF_STATUSES, DELIVERABLE_STATUS.AWAITING_CLIENT]);

async function countOverdue(db: SupabaseClient, today: DayString): Promise<number> {
  const { count, error } = await db
    .from('deliverables')
    .select('notion_id', { count: 'exact', head: true })
    .not('status', 'in', NOT_OVERDUE)
    .neq('type', 'Status Report')
    .lt('external_due_date', today);
  if (error) throw error;
  return count ?? 0;
}

/** How fast the overdue pile is moving: late items cleared vs items that fell due undone. */
async function overdueFlow(db: SupabaseClient, today: DayString): Promise<{ cleared: number; newlyOverdue: number }> {
  const since = addDays(today, -CLEARING_WINDOW_DAYS);
  const [cleared, fell] = await Promise.all([
    db
      .from('deliverables')
      .select('notion_id, date_done, external_due_date')
      .eq('status', DELIVERABLE_STATUS.FILED_OR_SENT_OUT)
      .neq('type', 'Status Report')
      .gte('date_done', since)
      .not('external_due_date', 'is', null),
    db
      .from('deliverables')
      .select('notion_id, date_done, external_due_date')
      .not('status', 'in', pgInList([DELIVERABLE_STATUS.SUBMITTED, DELIVERABLE_STATUS.ACKNOWLEDGED, DELIVERABLE_STATUS.ARCHIVED, DELIVERABLE_STATUS.AWAITING_CLIENT]))
      .neq('type', 'Status Report')
      .gte('external_due_date', since)
      .lt('external_due_date', today),
  ]);
  if (cleared.error) throw cleared.error;
  if (fell.error) throw fell.error;
  return {
    cleared: (cleared.data ?? []).filter((d) => d.external_due_date! < d.date_done!).length,
    newlyOverdue: (fell.data ?? []).filter((d) => !d.date_done || d.date_done > d.external_due_date!).length,
  };
}

/** Firm-wide numbers for a partner. Firm-scoped service reads: the caller checks the role. */
export async function getFirmGlance(firmId: string, today: DayString): Promise<FirmGlance> {
  const { start } = monthRange();
  const prev = lastMonthToDate(start, today);
  const db = getServiceDbForFirm(firmId);
  const prevEnd = addDays(start, -1);
  const [aggregates, prevAggregates, profiles, overdue, lastMonthHoursToDate, flow, hearingsNextWeek] = await Promise.all([
    getDTRAggregates(firmId, start, today),
    getDTRAggregates(firmId, prev.start, prevEnd),
    getLawyerProfiles(firmId),
    countOverdue(db, today),
    sumDtrHours(db, prev.start, prev.end),
    overdueFlow(db, today),
    countHearingsNextWeek(db),
  ]);
  const [utilization, lastMonth] = await Promise.all([
    getLawyerUtilization(start, today, aggregates, profiles),
    getLawyerUtilization(prev.start, prevEnd, prevAggregates, profiles),
  ]);
  return {
    monthHours: aggregates.reduce((s, a) => s + a.totalDecimalHours, 0),
    billedHours: aggregates.reduce((s, a) => s + a.billedHours, 0),
    lastMonthHoursToDate,
    utilization: utilization.firmAverage,
    lastMonthUtilization: lastMonth.firmAverage,
    overdueDeliverables: overdue,
    overdueCleared: flow.cleared,
    newlyOverdue: flow.newlyOverdue,
    hearingsNextWeek,
  };
}
