import { isStaticHoliday } from './ph-holidays';
import { fetchRuleSetById, type RuleDeadline } from './court-rules';
import { getPeriodById } from './prescriptive-periods';
import { getSupabase } from '@/lib/supabase';
import { utcCalendarDay } from '@/lib/dates';

export interface ComputedDeadline extends RuleDeadline {
  computedDate: string; // YYYY-MM-DD
}

// ── Date arithmetic ─────────────────────────────────────────────────
// All arithmetic is anchored in UTC so results are identical regardless
// of the server's timezone. Anchoring at local midnight and converting
// back via toISOString() shifts every date one day early on any UTC+N
// machine (e.g. Asia/Manila) — fatal for reglementary deadlines.

function toDate(iso: string): Date {
  return new Date(iso + 'T00:00:00Z');
}

function toISO(d: Date): string {
  return utcCalendarDay(d);
}

export function addCalendarDays(from: string, days: number): string {
  const d = toDate(from);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Add business days, skipping weekends and Philippine holidays.
 * Checks both static holidays (TS constants) and DB holidays (ad-hoc proclamations).
 */
export async function addBusinessDays(from: string, days: number): Promise<string> {
  // Pre-fetch DB holidays for the expected range (generous buffer)
  const maxCalendarDays = days * 2 + 30;
  const rangeEnd = addCalendarDays(from, maxCalendarDays);
  const dbHolidays = await fetchDBHolidays(from, rangeEnd);
  const dbHolidaySet = new Set(dbHolidays.map((h) => h.date));

  const d = toDate(from);
  let remaining = days;

  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = toISO(d);
    if (!isWeekend(d) && !isStaticHoliday(iso) && !dbHolidaySet.has(iso)) {
      remaining--;
    }
  }

  return toISO(d);
}

// `ph_holidays` is a global table (the Philippine holiday calendar is not
// firm-specific), so this read stays on the raw service client by design.
async function fetchDBHolidays(start: string, end: string): Promise<{ date: string }[]> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('ph_holidays')
      .select('date')
      .gte('date', start)
      .lte('date', end)
      .neq('type', 'special_working');
    return data ?? [];
  } catch {
    return [];
  }
}

// ── Deadline chain calculation ───────────────────────────────────────

/**
 * Compute all deadlines from a rule set given a trigger date.
 * Resolves `dependsOn` chains sequentially.
 */
export async function calculateDeadlinesFromRuleSet(
  ruleSetId: string,
  triggerDate: string,
): Promise<ComputedDeadline[]> {
  const ruleSet = await fetchRuleSetById(ruleSetId);
  if (!ruleSet) return [];

  const results: ComputedDeadline[] = [];
  const computedDates = new Map<string, string>(); // deadline.id → computed date

  // Process in order, respecting dependencies
  for (const deadline of ruleSet.deadlines) {
    const baseDate = deadline.dependsOn
      ? computedDates.get(deadline.dependsOn) ?? triggerDate
      : triggerDate;

    const computedDate =
      deadline.calendarType === 'business'
        ? await addBusinessDays(baseDate, deadline.daysFromTrigger)
        : addCalendarDays(baseDate, deadline.daysFromTrigger);

    computedDates.set(deadline.id, computedDate);
    results.push({ ...deadline, computedDate });
  }

  return results;
}

// ── SOL calculation ──────────────────────────────────────────────────

export function calculateSOLExpiry(
  periodId: string,
  accrualDate: string,
  tollingDays: number = 0,
): { expiryDate: string } | null {
  const period = getPeriodById(periodId);
  if (!period) return null;

  const d = toDate(accrualDate);
  d.setUTCFullYear(d.getUTCFullYear() + period.years);
  // Add tolling days (extends the expiry)
  if (tollingDays > 0) {
    d.setUTCDate(d.getUTCDate() + tollingDays);
  }

  return { expiryDate: toISO(d) };
}

// ── Urgency helpers ──────────────────────────────────────────────────

export type UrgencyLevel = 'expired' | 'critical' | 'warning' | 'normal';

export function getUrgencyLevel(targetDate: string): UrgencyLevel {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = toDate(targetDate);
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'expired';
  if (diffDays <= 30) return 'critical';
  if (diffDays <= 90) return 'warning';
  return 'normal';
}

export function daysRemaining(targetDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = toDate(targetDate);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
