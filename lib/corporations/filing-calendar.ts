import type { SupabaseClient } from '@supabase/supabase-js';
import type { FilingCalendarEntry } from '@/lib/corporations/obligations';

type Row = Record<string, unknown>;

/**
 * Who keeps the filing calendar current. Mirrors the RLS policy
 * compliance_calendar_editor_write, which is the actual gate.
 */
export const CALENDAR_EDITOR_ROLES = ['lawyer', 'partner', 'admin', 'super_user'];

export function rowToFilingCalendarEntry(r: Row): FilingCalendarEntry & { id: number; updatedAt: string | null } {
  return {
    id: Number(r.id),
    obligation: r.obligation as 'afs' | 'itr',
    filingYear: Number(r.filing_year),
    dueDate: (r.due_date as string | null) ?? null,
    originalDueDate: (r.original_due_date as string | null) ?? null,
    digitSchedule: (r.digit_schedule as Record<string, string> | null) ?? null,
    source: (r.source as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

/** The whole filing calendar — a handful of rows per year. */
export async function loadFilingCalendar(supabase: Pick<SupabaseClient, 'from'>): Promise<FilingCalendarEntry[]> {
  const { data } = await supabase.from('compliance_calendar').select('*').order('filing_year', { ascending: false });
  return Array.isArray(data) ? data.map((r) => rowToFilingCalendarEntry(r as Row)) : [];
}
