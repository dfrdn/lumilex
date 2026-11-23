import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { todayISO, thisWeekRange, monthRange } from '@/lib/dates';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';

// ── Types ──────────────────────────────────────────────────────────

export interface FirmDeliverableSummary {
  status: string;
  count: number;
}

export interface DTREntry {
  id: string;
  url: string;
  remarks: string;
  task: string;
  hours: number;
  minutes: number;
  date: string | null;
  lawyerName: string;
}

export interface DTRSummary {
  totalHours: number;
  totalMinutes: number;
  entries: DTREntry[];
  byLawyer: Record<string, { hours: number; minutes: number }>;
}

export interface LawyerStats {
  id: string;
  name: string;
  initials: string;
  position: string;
  personId: string;
  activeMatterCount: number;
  pendingDeliverables: number;
  ongoingMatters: string;
}

// ── Helpers ────────────────────────────────────────────────────────

function mapDTRRow(row: any): DTREntry {
  return {
    id: row.notion_id,
    url: row.notion_url,
    remarks: row.remarks,
    task: row.task,
    hours: row.hours,
    minutes: row.minutes,
    date: row.date,
    lawyerName: row.lawyer_name,
  };
}

function aggregateDTR(entries: DTREntry[]): DTRSummary {
  const byLawyer: Record<string, { hours: number; minutes: number }> = {};
  let totalHours = 0;
  let totalMinutes = 0;

  for (const e of entries) {
    totalHours += e.hours;
    totalMinutes += e.minutes;
    const name = e.lawyerName || 'Unknown';
    if (!byLawyer[name]) byLawyer[name] = { hours: 0, minutes: 0 };
    byLawyer[name].hours += e.hours;
    byLawyer[name].minutes += e.minutes;
  }

  // Normalize minutes overflow
  totalHours += Math.floor(totalMinutes / 60);
  totalMinutes = totalMinutes % 60;
  for (const key of Object.keys(byLawyer)) {
    byLawyer[key].hours += Math.floor(byLawyer[key].minutes / 60);
    byLawyer[key].minutes = byLawyer[key].minutes % 60;
  }

  return { totalHours, totalMinutes, entries, byLawyer };
}

// ── 1. Firm-wide Deliverable Workload ──────────────────────────────

export async function getFirmDeliverableSummary(firmId: string): Promise<{
  byStatus: FirmDeliverableSummary[];
  total: number;
}> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverables')
    .select('status')
    .not('status', 'in', pgInList(CLOSED_STATUSES));

  if (error) throw error;

  const statusCounts: Record<string, number> = {};
  for (const row of data ?? []) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
  }

  const byStatus = Object.entries(statusCounts)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return { byStatus, total: (data ?? []).length };
}

export async function getFirmOverdueDeliverables(firmId: string): Promise<number> {
  const today = todayISO();
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverables')
    .select('notion_id')
    .not('status', 'in', pgInList(CLOSED_STATUSES))
    .lt('external_due_date', today);

  if (error) throw error;
  return (data ?? []).length;
}

// ── 2. DTR / Billing Overview ─────────────────────────────────────

export async function getDTRThisWeek(firmId: string): Promise<DTRSummary> {
  const { start, end } = thisWeekRange();
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('dtr')
    .select('*')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: false });

  if (error) throw error;
  return aggregateDTR((data ?? []).map(mapDTRRow));
}

export async function getDTRThisMonth(firmId: string): Promise<DTRSummary> {
  const { start: monthStart, end: monthEnd } = monthRange();

  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('dtr')
    .select('*')
    .gte('date', monthStart)
    .lte('date', monthEnd)
    .order('date', { ascending: false });

  if (error) throw error;
  return aggregateDTR((data ?? []).map(mapDTRRow));
}

// ── 3. Team Performance Metrics ───────────────────────────────────

export async function getTeamPerformance(firmId: string): Promise<LawyerStats[]> {
  const supabase = getServiceDbForFirm(firmId);

  // Fetch active lawyers
  const { data: lawyers, error } = await supabase
    .from('team')
    .select('notion_id, name, initials, position, person_id, ongoing_matters')
    .eq('active', true);

  if (error) throw error;
  const lawyerRows = lawyers ?? [];

  // Fetch all active matters' team_person_ids to count per lawyer
  const { data: matterRows } = await supabase
    .from('matters')
    .select('team_person_ids');

  // Count matters per lawyer notion_id
  const matterCounts = new Map<string, number>();
  for (const m of matterRows ?? []) {
    for (const pid of m.team_person_ids ?? []) {
      matterCounts.set(pid, (matterCounts.get(pid) ?? 0) + 1);
    }
  }

  // Fetch all active deliverables' currently_with_ids to count pending per lawyer
  const { data: delivRows } = await supabase
    .from('deliverables')
    .select('currently_with_ids')
    .not('status', 'in', pgInList(CLOSED_STATUSES));

  // Count pending deliverables per person_id
  const pendingCounts = new Map<string, number>();
  for (const d of delivRows ?? []) {
    for (const pid of d.currently_with_ids ?? []) {
      pendingCounts.set(pid, (pendingCounts.get(pid) ?? 0) + 1);
    }
  }

  return lawyerRows.map((row: any) => ({
    id: row.notion_id,
    name: row.name,
    initials: row.initials,
    position: row.position,
    personId: row.person_id,
    activeMatterCount: matterCounts.get(row.notion_id) ?? 0,
    pendingDeliverables: pendingCounts.get(row.person_id) ?? 0,
    ongoingMatters: row.ongoing_matters,
  }));
}
