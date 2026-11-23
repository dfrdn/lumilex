import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getMeetingsForWeek } from '@/lib/queries/meetings';
import { getHearingsForWeek } from '@/lib/queries/hearings';
import { getFilingsForWeek } from '@/lib/queries/filings';
import { getStaticHolidaysInRange } from '@/lib/legal/ph-holidays';
import type { CalendarDeliverable, CalendarLeave } from '@/app/api/firm-calendar/month/route';
import { toDecimal } from '@/lib/dtr-utils';
import { getBaseline } from '@/lib/partner-lawyers/utilization';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { weekRange, addDays, manilaMonth, manilaYear, manilaMonthIndex, monthRange } from '@/lib/dates';

const PARTNER_ROLES = ['partner', 'super_user'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ personId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!PARTNER_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { personId } = await params;
  const weekStart = req.nextUrl.searchParams.get('weekStart');
  const month = req.nextUrl.searchParams.get('month'); // YYYY-MM for DTR

  if (!personId) {
    return NextResponse.json({ error: 'personId required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // Resolve lawyer info. Salary goes through the service role after the
  // partner check, ready for monthly_salary to be withheld from user JWTs.
  const { data: lawyerRow } = await getServiceDbForFirm(session.firmId)
    .from('team')
    .select('notion_id, person_id, name, initials, position, monthly_salary')
    .eq('person_id', personId)
    .limit(1)
    .single();

  if (!lawyerRow) {
    return NextResponse.json({ error: 'Lawyer not found' }, { status: 404 });
  }

  // ── Weekly Calendar ──────────────────────────────────────────
  // Compute week range (Mon-Sun) from weekStart or default to current week
  const wStartStr = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : weekRange().start;
  const wEndStr = addDays(wStartStr, 6);
  const pad = (n: number) => n.toString().padStart(2, '0');

  // Fetch calendar entities filtered by lawyer
  const [meetings, hearings, filings] = await Promise.all([
    getMeetingsForWeek(session.firmId, personId, wStartStr, wEndStr),
    getHearingsForWeek(session.firmId, wStartStr, wEndStr, personId),
    getFilingsForWeek(session.firmId, wStartStr, wEndStr, personId),
  ]);

  // Deliverables where this lawyer is a reviewer or drafter
  const { data: delivRows } = await supabase
    .from('deliverables')
    .select('notion_id, name, matter_name, matter_id, status, type, review_dates, reviewer_ids, drafter_ids, external_due_date')
    .not('status', 'in', pgInList(CLOSED_STATUSES))
    .or(`reviewer_ids.cs.{${personId}},drafter_ids.cs.{${personId}},currently_with_ids.cs.{${personId}}`);

  const deliverables: CalendarDeliverable[] = [];
  const filingIds = new Set(filings.map((f) => f.id));

  for (const row of delivRows ?? []) {
    if (filingIds.has(row.notion_id)) continue;

    const reviewDates: (string | null)[] = row.review_dates ?? [];
    const reviewerIds: string[] = row.reviewer_ids ?? [];
    const reviewerCount = reviewerIds.length;
    for (let i = 0; i < reviewDates.length; i++) {
      const rd = reviewDates[i];
      if (rd && rd >= wStartStr && rd <= wEndStr) {
        deliverables.push({
          id: row.notion_id, name: row.name, date: rd,
          dateType: 'review', reviewerIndex: i, reviewerCount,
          matter: row.matter_name ?? '', matterId: row.matter_id ?? null,
          status: row.status ?? '', type: row.type ?? '',
        });
      }
    }
    if (row.external_due_date && row.external_due_date >= wStartStr && row.external_due_date <= wEndStr) {
      deliverables.push({
        id: row.notion_id, name: row.name, date: row.external_due_date,
        dateType: 'deadline', matter: row.matter_name ?? '',
        matterId: row.matter_id ?? null, status: row.status ?? '', type: row.type ?? '',
      });
    }
  }

  // Leaves for this lawyer in the week range
  const { data: leavesData } = await supabase
    .from('leaves')
    .select('notion_id, name, leave_type, reason, period_start, period_end, status, approved')
    .eq('name', lawyerRow.name)
    .lte('period_start', wEndStr)
    .gte('period_end', wStartStr);

  const leaves: CalendarLeave[] = (leavesData ?? []).map((row) => ({
    id: row.notion_id, lawyerName: row.name ?? '',
    leaveType: row.leave_type ?? '', reason: row.reason ?? '',
    periodStart: row.period_start, periodEnd: row.period_end,
    status: row.status ?? '', approved: row.approved ?? false,
  }));

  // Holidays
  const staticHolidays = getStaticHolidaysInRange(wStartStr, wEndStr);
  const { data: dbHolidays } = await supabase
    .from('ph_holidays').select('date, name, type').gte('date', wStartStr).lte('date', wEndStr);
  const holidayMap = new Map(staticHolidays.map((h) => [h.date, h]));
  for (const h of dbHolidays ?? []) {
    if (!holidayMap.has(h.date)) holidayMap.set(h.date, h);
  }

  // ── Active Matters ──────────────────────────────────────────
  const { data: matters } = await supabase
    .from('matters')
    .select('notion_id, name, client_name, type, status, team_person_ids')
    .eq('status', 'Ongoing')
    .contains('team_person_ids', [personId]);

  const matterRows = matters ?? [];
  const typeBreakdown: Record<string, number> = {};
  for (const m of matterRows) {
    const t = m.type || 'Other';
    typeBreakdown[t] = (typeBreakdown[t] ?? 0) + 1;
  }

  // ── DTR ─────────────────────────────────────────────────────
  const dtrMonth = month || manilaMonth();
  const [yearStr, monthStr] = dtrMonth.split('-');
  const yr = parseInt(yearStr);
  const mo = parseInt(monthStr);
  const lastDay = new Date(yr, mo, 0).getDate();
  const monthStart = `${yearStr}-${monthStr}-01`;
  const monthEnd = `${yearStr}-${monthStr}-${pad(lastDay)}`;

  const { data: dtrRows } = await supabase
    .from('dtr')
    .select('notion_id, remarks, task, hours, minutes, date, lawyer_name, matter_id, client_name, matters!left(name)')
    .or(`lawyer_name.eq.${lawyerRow.name},with_ids.cs.{${personId}}`)
    .gte('date', monthStart)
    .lte('date', monthEnd)
    .order('date', { ascending: false });

  const dtrEntries = (dtrRows ?? []).map((row: any) => ({
    id: row.notion_id,
    remarks: row.remarks,
    task: row.task,
    hours: row.hours,
    minutes: row.minutes,
    date: row.date,
    lawyerName: row.lawyer_name,
    matterId: row.matter_id ?? null,
    matterName: row.matters?.name ?? '',
    clientName: row.client_name ?? '',
  }));

  // ── 6-month utilization trend ───────────────────────────────
  // Pull DTR for the last 6 months (including current) and aggregate hours
  // per month for this lawyer. Uses the same credit model as /api/partner/lawyers.
  const trendMonths: string[] = [];
  // Month arithmetic only (year/month rollover), on the Manila calendar month.
  const thisYear = manilaYear();
  const thisMonthIndex = manilaMonthIndex();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(thisYear, thisMonthIndex - i, 1);
    trendMonths.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  const trendStart = `${trendMonths[0]}-01`;
  const trendEnd = monthRange().end;

  const { data: trendRows } = await supabase
    .from('dtr')
    .select('hours, minutes, date, lawyer_name, with_ids')
    .or(`lawyer_name.eq.${lawyerRow.name},with_ids.cs.{${personId}}`)
    .gte('date', trendStart)
    .lte('date', trendEnd);

  const trendByMonth = new Map<string, number>();
  for (const m of trendMonths) trendByMonth.set(m, 0);
  for (const r of trendRows ?? []) {
    if (!r.date) continue;
    const ym = r.date.slice(0, 7);
    if (!trendByMonth.has(ym)) continue;
    trendByMonth.set(ym, (trendByMonth.get(ym) ?? 0) + toDecimal(r.hours, r.minutes));
  }

  const baseline = getBaseline(lawyerRow.position);
  const trend = trendMonths.map((m) => ({
    month: m,
    hours: Math.round((trendByMonth.get(m) ?? 0) * 10) / 10,
    target: baseline.hours,
  }));

  return NextResponse.json({
    lawyer: {
      id: lawyerRow.notion_id,
      personId: lawyerRow.person_id,
      name: lawyerRow.name,
      initials: lawyerRow.initials,
      position: lawyerRow.position,
      monthlySalary:
        lawyerRow.monthly_salary == null ? null : Number(lawyerRow.monthly_salary),
    },
    calendar: {
      weekStart: wStartStr,
      weekEnd: wEndStr,
      deliverables,
      meetings,
      hearings,
      filings,
      holidays: Array.from(holidayMap.values()),
      leaves,
    },
    matters: {
      items: matterRows,
      typeBreakdown,
      total: matterRows.length,
    },
    dtr: {
      month: dtrMonth,
      entries: dtrEntries,
    },
    trend,
  });
}
