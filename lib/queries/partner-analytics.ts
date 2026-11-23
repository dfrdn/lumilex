import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { manilaDayEnd, manilaDayStart, manilaToday, monthRange, todayISO, toManilaDay } from '@/lib/dates';
import { toDecimal } from '@/lib/dtr-utils';
import { CLOSED_STATUSES, DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';

// ── Types ──────────────────────────────────────────────────────────

export interface LawyerProfile {
  name: string;
  initials: string;
  position: string;
  personId: string;
  active: boolean;
}

export interface MonthlyDTRAggregate {
  month: string; // "YYYY-MM"
  totalDecimalHours: number;
  billedHours: number;
  byLawyer: Record<string, number>; // lawyer_name → decimal hours
  byClient: Record<string, number>; // client_name → decimal hours
  byMatterType: Record<string, number>; // matters.type → decimal hours
  entryCount: number;
}

export const UNASSIGNED_MATTER_TYPE = 'Unassigned';

export interface DeliverableSnapshot {
  byStatus: { status: string; count: number }[];
  total: number;
  overdueCount: number;
  byLawyer: { lawyerName: string; pending: number; overdue: number }[];
}

export interface MonthlyHearingFilingAggregate {
  month: string; // "YYYY-MM"
  hearingCount: number;
  filingCount: number;
}

export interface MatterDistribution {
  byLawyer: { lawyerName: string; initials: string; matterCount: number }[];
  byClient: { clientName: string; matterCount: number }[];
  total: number;
}

export interface CurrentMonthSummary {
  totalHours: number;
  billedHours: number;
  unbilledHours: number;
  entryCount: number;
  byLawyer: { name: string; hours: number; billed: number }[];
  byClient: { name: string; hours: number }[];
  daysElapsed: number;
  daysInMonth: number;
}

export interface RevenueProjection {
  byMonth: { month: string; revenue: number; billedRevenue: number; unbilledRevenue: number }[];
  byLawyer: { name: string; hours: number; rate: number; revenue: number }[];
  byClient: { name: string; revenue: number }[];
  totalRevenue: number;
  totalBilledRevenue: number;
}

export interface TurnaroundStats {
  draftAvgDays: number;
  finalizationAvgDays: number;
  totalAvgDays: number;
  byLawyer: { name: string; draftAvg: number; finalizationAvg: number; totalAvg: number; count: number }[];
  trend: { month: string; draftAvg: number; finalizationAvg: number; totalAvg: number }[];
}

export interface LawyerUtilization {
  byLawyer: { name: string; hours: number; workingDays: number; utilization: number }[];
  firmAverage: number;
}

export interface CaseOutcomeStats {
  total: number;
  favorable: number;
  unfavorable: number;
  settled: number;
  pending: number;
  dismissed: number;
  other: number;
  byType: { type: string; favorable: number; unfavorable: number; total: number }[];
  recentOutcomes: { name: string; outcome: string; type: string; clientName: string; classification: string }[];
}

// ── Helpers ────────────────────────────────────────────────────────

/** Fetch all rows, paginating in chunks of 1000 to bypass Supabase default limit. */
async function fetchAll<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFn(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── Queries ────────────────────────────────────────────────────────

export async function getLawyerProfiles(firmId: string, activeOnly = false): Promise<LawyerProfile[]> {
  const supabase = getServiceDbForFirm(firmId);
  let query = supabase.from('team').select('*');
  if (activeOnly) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    name: row.name,
    initials: row.initials,
    position: row.position,
    personId: row.person_id,
    active: row.active,
  }));
}

export async function getDTRAggregates(firmId: string, 
  startDate: string,
  endDate: string,
): Promise<MonthlyDTRAggregate[]> {
  const supabase = getServiceDbForFirm(firmId);
  const rows = await fetchAll((from, to) =>
    supabase
      .from('dtr')
      .select('date, hours, minutes, lawyer_name, with_names, client_name, matter_id, billed')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .range(from, to),
  );

  const matterRows = await fetchAll((from, to) =>
    supabase.from('matters').select('notion_id, type').range(from, to),
  );
  const matterTypeById: Record<string, string> = {};
  for (const m of matterRows) {
    matterTypeById[m.notion_id as string] = (m.type as string) || '';
  }

  const monthMap: Record<
    string,
    {
      total: number;
      billed: number;
      byLawyer: Record<string, number>;
      byClient: Record<string, number>;
      byMatterType: Record<string, number>;
      entryCount: number;
    }
  > = {};

  for (const row of rows) {
    if (!row.date) continue;
    const month = (row.date as string).substring(0, 7);
    if (!monthMap[month]) monthMap[month] = { total: 0, billed: 0, byLawyer: {}, byClient: {}, byMatterType: {}, entryCount: 0 };
    const dec = toDecimal(row.hours ?? 0, row.minutes ?? 0);
    monthMap[month].total += dec;
    if (row.billed) monthMap[month].billed += dec;
    monthMap[month].entryCount += 1;
    // Attribute hours to all involved people (lawyer_name + with_names)
    const people = new Set<string>();
    if (row.lawyer_name) people.add(row.lawyer_name);
    for (const n of (row.with_names as string[]) ?? []) {
      if (n) people.add(n);
    }
    if (people.size === 0) people.add('Unknown');
    for (const name of people) {
      monthMap[month].byLawyer[name] = (monthMap[month].byLawyer[name] ?? 0) + dec;
    }
    const client = row.client_name || '';
    if (client) {
      monthMap[month].byClient[client] = (monthMap[month].byClient[client] ?? 0) + dec;
    }
    const matterType = (row.matter_id ? matterTypeById[row.matter_id as string] : '') || UNASSIGNED_MATTER_TYPE;
    monthMap[month].byMatterType[matterType] = (monthMap[month].byMatterType[matterType] ?? 0) + dec;
  }

  return Object.entries(monthMap)
    .map(([month, agg]) => ({
      month,
      totalDecimalHours: agg.total,
      billedHours: agg.billed,
      byLawyer: agg.byLawyer,
      byClient: agg.byClient,
      byMatterType: agg.byMatterType,
      entryCount: agg.entryCount,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function getDeliverableSnapshot(firmId: string, 
  lawyers: LawyerProfile[],
): Promise<DeliverableSnapshot> {
  const today = todayISO();
  const supabase = getServiceDbForFirm(firmId);
  const rows = await fetchAll((from, to) =>
    supabase
      .from('deliverables')
      .select('status, external_due_date, currently_with_ids')
      .not('status', 'in', pgInList(CLOSED_STATUSES))
      .range(from, to),
  );
  const personIdToName: Record<string, string> = {};
  for (const l of lawyers) personIdToName[l.personId] = l.name;

  const statusCounts: Record<string, number> = {};
  let overdueCount = 0;
  const lawyerPending: Record<string, { pending: number; overdue: number }> = {};

  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    const isOverdue = row.external_due_date && row.external_due_date < today;
    if (isOverdue) overdueCount++;

    const withIds: string[] = row.currently_with_ids ?? [];
    for (const pid of withIds) {
      const name = personIdToName[pid];
      if (!name) continue;
      if (!lawyerPending[name]) lawyerPending[name] = { pending: 0, overdue: 0 };
      lawyerPending[name].pending += 1;
      if (isOverdue) lawyerPending[name].overdue += 1;
    }
  }

  return {
    byStatus: Object.entries(statusCounts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    total: rows.length,
    overdueCount,
    byLawyer: Object.entries(lawyerPending)
      .map(([lawyerName, counts]) => ({ lawyerName, ...counts }))
      .sort((a, b) => b.overdue - a.overdue || b.pending - a.pending),
  };
}

export async function getHearingFilingAggregates(firmId: string, 
  startDate: string,
  endDate: string,
): Promise<MonthlyHearingFilingAggregate[]> {
  const supabase = getServiceDbForFirm(firmId);

  // Fetch hearings
  const hearingRows = await fetchAll((from, to) =>
    supabase
      .from('hearings')
      .select('date')
      .gte('date', manilaDayStart(startDate))
      .lte('date', manilaDayEnd(endDate))
      .order('date', { ascending: true })
      .range(from, to),
  );

  // Fetch matters that are cases (have case_title, case_number, or court)
  const caseMatterRows = await fetchAll((from, to) =>
    supabase
      .from('matters')
      .select('notion_id, case_title, case_number, court')
      .range(from, to),
  );
  const caseMatterIds = new Set(
    caseMatterRows
      .filter((m) => m.case_title || m.case_number || m.court)
      .map((m) => m.notion_id as string),
  );

  // Filings = deliverables whose matter is a case, grouped by due date
  const deliverableRows = caseMatterIds.size > 0
    ? await fetchAll((from, to) =>
        supabase
          .from('deliverables')
          .select('external_due_date, matter_id')
          .not('external_due_date', 'is', null)
          .gte('external_due_date', startDate)
          .lte('external_due_date', endDate)
          .range(from, to),
      )
    : [];

  const monthMap: Record<string, { hearings: number; filings: number }> = {};

  for (const row of hearingRows) {
    if (!row.date) continue;
    const month = toManilaDay(row.date as string).slice(0, 7);
    if (!monthMap[month]) monthMap[month] = { hearings: 0, filings: 0 };
    monthMap[month].hearings += 1;
  }

  for (const row of deliverableRows) {
    if (!row.matter_id || !caseMatterIds.has(row.matter_id as string)) continue;
    const month = (row.external_due_date as string).substring(0, 7);
    if (!monthMap[month]) monthMap[month] = { hearings: 0, filings: 0 };
    monthMap[month].filings += 1;
  }

  return Object.entries(monthMap)
    .map(([month, counts]) => ({
      month,
      hearingCount: counts.hearings,
      filingCount: counts.filings,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function getMatterDistribution(firmId: string, 
  lawyers: LawyerProfile[],
): Promise<MatterDistribution> {
  const supabase = getServiceDbForFirm(firmId);
  const rows = await fetchAll((from, to) =>
    supabase
      .from('matters')
      .select('team_person_ids, client_name')
      .range(from, to),
  );
  const personIdToProfile: Record<string, LawyerProfile> = {};
  for (const l of lawyers) personIdToProfile[l.personId] = l;

  const lawyerCounts: Record<string, { name: string; initials: string; count: number }> = {};
  const clientCounts: Record<string, number> = {};

  for (const row of rows) {
    const teamIds: string[] = row.team_person_ids ?? [];
    for (const pid of teamIds) {
      const profile = personIdToProfile[pid];
      if (!profile) continue;
      if (!lawyerCounts[profile.name]) {
        lawyerCounts[profile.name] = { name: profile.name, initials: profile.initials, count: 0 };
      }
      lawyerCounts[profile.name].count += 1;
    }

    const client = row.client_name || 'No Client';
    clientCounts[client] = (clientCounts[client] ?? 0) + 1;
  }

  const byLawyer = Object.values(lawyerCounts)
    .map((l) => ({ lawyerName: l.name, initials: l.initials, matterCount: l.count }))
    .sort((a, b) => b.matterCount - a.matterCount);

  const byClient = Object.entries(clientCounts)
    .map(([clientName, matterCount]) => ({ clientName, matterCount }))
    .sort((a, b) => b.matterCount - a.matterCount)
    .slice(0, 15);

  return { byLawyer, byClient, total: rows.length };
}

// ── Current Month Summary ────────────────────────────────────────

export async function getCurrentMonthSummary(firmId: string): Promise<CurrentMonthSummary> {
  const supabase = getServiceDbForFirm(firmId);
  const { start: startDate, end: endDate } = monthRange();
  const lastDay = Number(endDate.slice(8, 10));
  const daysElapsed = Number(manilaToday().slice(8, 10));

  const rows = await fetchAll((from, to) =>
    supabase
      .from('dtr')
      .select('hours, minutes, lawyer_name, with_names, client_name, billed')
      .gte('date', startDate)
      .lte('date', endDate)
      .range(from, to),
  );

  let totalHours = 0;
  let billedHours = 0;
  const lawyerMap: Record<string, { hours: number; billed: number }> = {};
  const clientMap: Record<string, number> = {};

  for (const row of rows) {
    const dec = toDecimal(row.hours ?? 0, row.minutes ?? 0);
    totalHours += dec;
    if (row.billed) billedHours += dec;

    const people = new Set<string>();
    if (row.lawyer_name) people.add(row.lawyer_name);
    for (const n of (row.with_names as string[]) ?? []) {
      if (n) people.add(n);
    }
    for (const name of people) {
      if (!lawyerMap[name]) lawyerMap[name] = { hours: 0, billed: 0 };
      lawyerMap[name].hours += dec;
      if (row.billed) lawyerMap[name].billed += dec;
    }

    const client = row.client_name || '';
    if (client) clientMap[client] = (clientMap[client] ?? 0) + dec;
  }

  return {
    totalHours,
    billedHours,
    unbilledHours: totalHours - billedHours,
    entryCount: rows.length,
    byLawyer: Object.entries(lawyerMap)
      .map(([name, v]) => ({ name, hours: v.hours, billed: v.billed }))
      .sort((a, b) => b.hours - a.hours),
    byClient: Object.entries(clientMap)
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10),
    daysElapsed,
    daysInMonth: lastDay,
  };
}

// ── Case Outcomes ────────────────────────────────────────────────

const FAVORABLE = ['win', 'won', 'favorable', 'granted', 'approved', 'sustained', 'acquitted'];
const UNFAVORABLE = ['loss', 'lost', 'unfavorable', 'denied', 'disapproved', 'overruled', 'convicted'];
const SETTLED = ['settled', 'compromised', 'amicable', 'mediated'];
const DISMISSED = ['dismissed', 'withdrawn', 'moot', 'archived', 'terminated'];

function classifyOutcome(outcome: string): 'favorable' | 'unfavorable' | 'settled' | 'dismissed' | 'other' {
  const lower = outcome.toLowerCase();
  if (FAVORABLE.some((k) => lower.includes(k))) return 'favorable';
  if (UNFAVORABLE.some((k) => lower.includes(k))) return 'unfavorable';
  if (SETTLED.some((k) => lower.includes(k))) return 'settled';
  if (DISMISSED.some((k) => lower.includes(k))) return 'dismissed';
  return 'other';
}

export async function getCaseOutcomes(firmId: string): Promise<CaseOutcomeStats> {
  const supabase = getServiceDbForFirm(firmId);
  const rows = await fetchAll((from, to) =>
    supabase
      .from('matters')
      .select('name, outcome, type, status, client_name, case_title, case_number')
      .not('case_title', 'is', null)
      .not('case_number', 'is', null)
      .range(from, to),
  );

  let favorable = 0;
  let unfavorable = 0;
  let settled = 0;
  let dismissed = 0;
  let other = 0;
  let pending = 0;
  const typeMap: Record<string, { favorable: number; unfavorable: number; total: number }> = {};
  const recentOutcomes: CaseOutcomeStats['recentOutcomes'] = [];

  for (const row of rows) {
    const type = row.type || 'Other';
    if (!typeMap[type]) typeMap[type] = { favorable: 0, unfavorable: 0, total: 0 };

    if (!row.outcome || row.outcome.trim() === '') {
      // No outcome yet — count as pending if status is ongoing
      if (row.status === 'Ongoing' || row.status === '') pending++;
      continue;
    }

    const cls = classifyOutcome(row.outcome);
    typeMap[type].total++;
    if (cls === 'favorable') { favorable++; typeMap[type].favorable++; }
    else if (cls === 'unfavorable') { unfavorable++; typeMap[type].unfavorable++; }
    else if (cls === 'settled') { settled++; }
    else if (cls === 'dismissed') { dismissed++; }
    else { other++; }

    recentOutcomes.push({
      name: row.name,
      outcome: row.outcome,
      type,
      clientName: row.client_name || '',
      classification: cls,
    });
  }

  const totalResolved = favorable + unfavorable + settled + dismissed + other;

  return {
    total: totalResolved,
    favorable,
    unfavorable,
    settled,
    dismissed,
    pending,
    other,
    byType: Object.entries(typeMap)
      .map(([type, counts]) => ({ type, ...counts }))
      .filter((t) => t.total > 0)
      .sort((a, b) => b.total - a.total),
    recentOutcomes,
  };
}

// ── Revenue Projection ────────────────────────────────────────────

export async function getRevenueProjection(firmId: string, 
  startDate: string,
  endDate: string,
): Promise<RevenueProjection> {
  const supabase = getServiceDbForFirm(firmId);

  const [dtrRows, teamRows, rateRows] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from('dtr')
        .select('date, hours, minutes, lawyer_name, with_names, client_name, billed')
        .gte('date', startDate)
        .lte('date', endDate)
        .range(from, to),
    ),
    supabase.from('team').select('name, position').then((r) => r.data ?? []),
    supabase.from('billing_rates').select('position, hourly_rate').then((r) => r.data ?? []),
  ]);

  const positionMap: Record<string, string> = {};
  for (const t of teamRows) positionMap[t.name] = t.position;

  const rateMap: Record<string, number> = {};
  for (const r of rateRows) rateMap[r.position] = Number(r.hourly_rate);

  const getRate = (name: string) => rateMap[positionMap[name] ?? ''] ?? 0;

  const monthRevenue: Record<string, { revenue: number; billed: number; unbilled: number }> = {};
  const lawyerRevenue: Record<string, { hours: number; revenue: number }> = {};
  const clientRevenue: Record<string, number> = {};

  for (const row of dtrRows) {
    if (!row.date) continue;
    const month = (row.date as string).substring(0, 7);
    const dec = toDecimal(row.hours ?? 0, row.minutes ?? 0);

    const people = new Set<string>();
    if (row.lawyer_name) people.add(row.lawyer_name);
    for (const n of (row.with_names as string[]) ?? []) {
      if (n) people.add(n);
    }

    for (const name of people) {
      const rate = getRate(name);
      const rev = dec * rate;

      if (!monthRevenue[month]) monthRevenue[month] = { revenue: 0, billed: 0, unbilled: 0 };
      monthRevenue[month].revenue += rev;
      if (row.billed) monthRevenue[month].billed += rev;
      else monthRevenue[month].unbilled += rev;

      if (!lawyerRevenue[name]) lawyerRevenue[name] = { hours: 0, revenue: 0 };
      lawyerRevenue[name].hours += dec;
      lawyerRevenue[name].revenue += rev;
    }

    const client = row.client_name || '';
    if (client) {
      const avgRate = people.size > 0
        ? [...people].reduce((s, n) => s + getRate(n), 0) / people.size
        : 0;
      clientRevenue[client] = (clientRevenue[client] ?? 0) + dec * avgRate;
    }
  }

  const byMonth = Object.entries(monthRevenue)
    .map(([month, v]) => ({ month, revenue: v.revenue, billedRevenue: v.billed, unbilledRevenue: v.unbilled }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const byLawyer = Object.entries(lawyerRevenue)
    .map(([name, v]) => ({ name, hours: v.hours, rate: getRate(name), revenue: v.revenue }))
    .filter((l) => l.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);

  const byClient = Object.entries(clientRevenue)
    .map(([name, revenue]) => ({ name, revenue }))
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 15);

  return {
    byMonth,
    byLawyer,
    byClient,
    totalRevenue: byMonth.reduce((s, m) => s + m.revenue, 0),
    totalBilledRevenue: byMonth.reduce((s, m) => s + m.billedRevenue, 0),
  };
}

// ── Deliverable Turnaround ────────────────────────────────────────

export async function getDeliverableTurnaround(firmId: string): Promise<TurnaroundStats> {
  const supabase = getServiceDbForFirm(firmId);

  // Get completed deliverables
  const deliverables = await fetchAll((from, to) =>
    supabase
      .from('deliverables')
      .select('notion_id, created_time, date_done, drafter_ids, matter_name')
      .eq('status', DELIVERABLE_STATUS.FILED_OR_SENT_OUT)
      .not('created_time', 'is', null)
      .range(from, to),
  );

  // Get action log for milestone timestamps
  const actions = await fetchAll((from, to) =>
    supabase
      .from('deliverable_actions')
      .select('deliverable_id, new_status, created_at')
      .in('new_status', [DELIVERABLE_STATUS.UNDER_REVIEW, DELIVERABLE_STATUS.FINALIZING, DELIVERABLE_STATUS.FILED_OR_SENT_OUT])
      .order('created_at', { ascending: true })
      .range(from, to),
  );

  // Get team for drafter name resolution
  const { data: teamData } = await supabase.from('team').select('person_id, name');
  const personIdToName: Record<string, string> = {};
  for (const t of teamData ?? []) personIdToName[t.person_id] = t.name;

  // Group actions by deliverable
  const actionsByDeliv: Record<string, Record<string, string>> = {}; // delivId → { status → earliest timestamp }
  for (const a of actions) {
    const did = a.deliverable_id as string;
    if (!actionsByDeliv[did]) actionsByDeliv[did] = {};
    // Only keep the first occurrence of each status
    if (!actionsByDeliv[did][a.new_status as string]) {
      actionsByDeliv[did][a.new_status as string] = a.created_at as string;
    }
  }

  const daysBetween = (start: string, end: string) => {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(0, ms / (1000 * 60 * 60 * 24));
  };

  // Per-deliverable turnaround calculations
  interface DelivTurnaround {
    draftDays: number | null;
    finalizationDays: number | null;
    totalDays: number | null;
    drafterName: string;
    month: string;
  }

  const turnarounds: DelivTurnaround[] = [];

  for (const d of deliverables) {
    if (!d.created_time) continue;
    const created = d.created_time as string;
    const milestones = actionsByDeliv[d.notion_id as string] ?? {};

    const draftDays = milestones[DELIVERABLE_STATUS.UNDER_REVIEW]
      ? daysBetween(created, milestones[DELIVERABLE_STATUS.UNDER_REVIEW])
      : null;

    const finalizationDays = milestones[DELIVERABLE_STATUS.FINALIZING]
      ? daysBetween(created, milestones[DELIVERABLE_STATUS.FINALIZING])
      : null;

    const totalDays = d.date_done
      ? daysBetween(created, d.date_done as string)
      : milestones[DELIVERABLE_STATUS.FILED_OR_SENT_OUT]
        ? daysBetween(created, milestones[DELIVERABLE_STATUS.FILED_OR_SENT_OUT])
        : null;

    const drafterIds: string[] = (d.drafter_ids as string[]) ?? [];
    const drafterName = drafterIds.length > 0
      ? personIdToName[drafterIds[0]] ?? 'Unknown'
      : 'Unknown';

    const month = created.substring(0, 7);

    turnarounds.push({ draftDays, finalizationDays, totalDays, drafterName, month });
  }

  // Aggregate
  const avg = (nums: number[]) => nums.length > 0 ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;

  const allDraft = turnarounds.filter((t) => t.draftDays !== null).map((t) => t.draftDays!);
  const allFinal = turnarounds.filter((t) => t.finalizationDays !== null).map((t) => t.finalizationDays!);
  const allTotal = turnarounds.filter((t) => t.totalDays !== null).map((t) => t.totalDays!);

  // By lawyer
  const lawyerMap: Record<string, { draft: number[]; final: number[]; total: number[]; count: number }> = {};
  for (const t of turnarounds) {
    if (!lawyerMap[t.drafterName]) lawyerMap[t.drafterName] = { draft: [], final: [], total: [], count: 0 };
    lawyerMap[t.drafterName].count++;
    if (t.draftDays !== null) lawyerMap[t.drafterName].draft.push(t.draftDays);
    if (t.finalizationDays !== null) lawyerMap[t.drafterName].final.push(t.finalizationDays);
    if (t.totalDays !== null) lawyerMap[t.drafterName].total.push(t.totalDays);
  }

  // By month trend
  const monthMap: Record<string, { draft: number[]; final: number[]; total: number[] }> = {};
  for (const t of turnarounds) {
    if (!monthMap[t.month]) monthMap[t.month] = { draft: [], final: [], total: [] };
    if (t.draftDays !== null) monthMap[t.month].draft.push(t.draftDays);
    if (t.finalizationDays !== null) monthMap[t.month].final.push(t.finalizationDays);
    if (t.totalDays !== null) monthMap[t.month].total.push(t.totalDays);
  }

  return {
    draftAvgDays: Math.round(avg(allDraft) * 10) / 10,
    finalizationAvgDays: Math.round(avg(allFinal) * 10) / 10,
    totalAvgDays: Math.round(avg(allTotal) * 10) / 10,
    byLawyer: Object.entries(lawyerMap)
      .map(([name, v]) => ({
        name,
        draftAvg: Math.round(avg(v.draft) * 10) / 10,
        finalizationAvg: Math.round(avg(v.final) * 10) / 10,
        totalAvg: Math.round(avg(v.total) * 10) / 10,
        count: v.count,
      }))
      .filter((l) => l.count > 0)
      .sort((a, b) => a.totalAvg - b.totalAvg),
    trend: Object.entries(monthMap)
      .map(([month, v]) => ({
        month,
        draftAvg: Math.round(avg(v.draft) * 10) / 10,
        finalizationAvg: Math.round(avg(v.final) * 10) / 10,
        totalAvg: Math.round(avg(v.total) * 10) / 10,
      }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

// ── Lawyer Utilization ────────────────────────────────────────────

function countWorkingDays(startDate: string, endDate: string): number {
  let count = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export async function getLawyerUtilization(
  startDate: string,
  endDate: string,
  dtrAggregates: MonthlyDTRAggregate[],
  lawyerProfiles: LawyerProfile[],
): Promise<LawyerUtilization> {
  const workingDays = countWorkingDays(startDate, endDate);
  const targetHours = workingDays * 8;

  // Sum hours per lawyer across all months
  const lawyerHours: Record<string, number> = {};
  for (const agg of dtrAggregates) {
    for (const [name, hours] of Object.entries(agg.byLawyer)) {
      lawyerHours[name] = (lawyerHours[name] ?? 0) + hours;
    }
  }

  // Only include lawyers (exclude admin/finance roles)
  const lawyerNames = new Set(
    lawyerProfiles
      .filter((l) => l.active && !['admin', 'finance'].includes(l.position?.toLowerCase() ?? ''))
      .map((l) => l.name),
  );

  const byLawyer = Object.entries(lawyerHours)
    .filter(([name]) => lawyerNames.has(name))
    .map(([name, hours]) => ({
      name,
      hours,
      workingDays,
      utilization: targetHours > 0 ? Math.round((hours / targetHours) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.utilization - a.utilization);

  const firmAverage = byLawyer.length > 0
    ? Math.round((byLawyer.reduce((s, l) => s + l.utilization, 0) / byLawyer.length) * 10) / 10
    : 0;

  return { byLawyer, firmAverage };
}
