import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getFirmMeetingsForWeek } from '@/lib/queries/meetings';
import { getHearingsForWeek } from '@/lib/queries/hearings';
import { getFilingsForWeek } from '@/lib/queries/filings';
import { getStaticHolidaysInRange } from '@/lib/legal/ph-holidays';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';

export interface CalendarLeave {
  id: string;
  lawyerName: string;
  leaveType: string;
  reason: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  approved: boolean;
}

export interface CalendarDeliverable {
  id: string;
  name: string;
  date: string;
  dateType: 'review' | 'deadline';
  reviewerIndex?: number;
  reviewerCount?: number;
  matter: string;
  matterId: string | null;
  status: string;
  type: string;
}

export interface CalendarMeeting {
  id: string;
  name: string;
  date: string;
  matter: string;
  matterId: string | null;
  type: string;
}

export interface CalendarHearing {
  id: string;
  name: string;
  date: string;
  matter: string;
  matterId: string | null;
  type: string;
  status: string;
}

export interface CalendarFiling {
  id: string;
  name: string;
  date: string;
  matter: string;
  matterId: string | null;
  status: string;
}

export interface CalendarHoliday {
  date: string;
  name: string;
  type: string;
}

export interface CalendarErrand {
  id: number;
  name: string;
  date: string;
  assigneeName: string;
  zoneName: string | null;
  status: string;
  matter: string;
  matterId: string | null;
}

export interface FirmCalendarData {
  deliverables: CalendarDeliverable[];
  meetings: CalendarMeeting[];
  hearings: CalendarHearing[];
  filings: CalendarFiling[];
  holidays: CalendarHoliday[];
  leaves: CalendarLeave[];
  errands: CalendarErrand[];
}

/**
 * Fetch all firm calendar data for a date range.
 * Shared between the live calendar API and the PDF export.
 */
export async function getFirmCalendarMonthData(firmId: string, 
  start: string,
  end: string,
): Promise<FirmCalendarData> {
  const supabase = getServiceDbForFirm(firmId);

  // Fetch deliverables with any date field in range
  const deliverableQuery = supabase
    .from('deliverables')
    .select('notion_id, name, matter_name, matter_id, status, type, review_dates, reviewer_ids, external_due_date')
    .not('status', 'in', pgInList(CLOSED_STATUSES));

  // Fetch leaves overlapping the date range
  const leavesQuery = supabase
    .from('leaves')
    .select('notion_id, name, leave_type, reason, period_start, period_end, status, approved')
    .lte('period_start', end)
    .gte('period_end', start);

  // Fetch liaison errands scheduled in range
  const errandsQuery = supabase
    .from('liaison_tasks')
    .select('id, title, scheduled_for, assigned_to_name, status, matter_id, matter_name, transportation_zones ( name )')
    .gte('scheduled_for', start)
    .lte('scheduled_for', end);

  const [deliverableResult, meetings, hearings, filings, leavesResult, errandsResult] = await Promise.all([
    deliverableQuery,
    getFirmMeetingsForWeek(firmId, start, end),
    getHearingsForWeek(firmId, start, end),
    getFilingsForWeek(firmId, start, end),
    leavesQuery,
    errandsQuery,
  ]);

  // Flatten deliverables into per-date entries
  const deliverables: CalendarDeliverable[] = [];
  const filingIds = new Set(filings.map((f: { id: string }) => f.id));

  for (const row of deliverableResult.data ?? []) {
    if (filingIds.has(row.notion_id)) continue;

    const reviewDates: (string | null)[] = row.review_dates ?? [];
    const reviewerIds: string[] = row.reviewer_ids ?? [];
    const reviewerCount = reviewerIds.length;
    for (let i = 0; i < reviewDates.length; i++) {
      const rd = reviewDates[i];
      if (rd && rd >= start && rd <= end) {
        deliverables.push({
          id: row.notion_id,
          name: row.name,
          date: rd,
          dateType: 'review',
          reviewerIndex: i,
          reviewerCount,
          matter: row.matter_name ?? '',
          matterId: row.matter_id ?? null,
          status: row.status ?? '',
          type: row.type ?? '',
        });
      }
    }
    if (row.external_due_date && row.external_due_date >= start && row.external_due_date <= end) {
      deliverables.push({
        id: row.notion_id,
        name: row.name,
        date: row.external_due_date,
        dateType: 'deadline',
        matter: row.matter_name ?? '',
        matterId: row.matter_id ?? null,
        status: row.status ?? '',
        type: row.type ?? '',
      });
    }
  }

  // Holidays
  const staticHolidays = getStaticHolidaysInRange(start, end);
  const { data: dbHolidays } = await supabase
    .from('ph_holidays')
    .select('date, name, type')
    .gte('date', start)
    .lte('date', end);

  const holidayMap = new Map(staticHolidays.map((h) => [h.date, h]));
  for (const h of dbHolidays ?? []) {
    if (!holidayMap.has(h.date)) holidayMap.set(h.date, h);
  }

  const leaves: CalendarLeave[] = (leavesResult.data ?? []).map((row) => ({
    id: row.notion_id,
    lawyerName: row.name ?? '',
    leaveType: row.leave_type ?? '',
    reason: row.reason ?? '',
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status ?? '',
    approved: row.approved ?? false,
  }));

  const errands: CalendarErrand[] = (errandsResult.data ?? []).map((row) => {
    const zone = Array.isArray(row.transportation_zones)
      ? row.transportation_zones[0]
      : row.transportation_zones;
    return {
      id: row.id as number,
      name: row.title ?? '',
      date: row.scheduled_for as string,
      assigneeName: row.assigned_to_name ?? '',
      zoneName: zone?.name ?? null,
      status: row.status ?? '',
      matter: row.matter_name ?? '',
      matterId: row.matter_id ?? null,
    };
  });

  return {
    deliverables,
    meetings: meetings as CalendarMeeting[],
    hearings: hearings as CalendarHearing[],
    filings: filings as CalendarFiling[],
    holidays: Array.from(holidayMap.values()),
    leaves,
    errands,
  };
}
