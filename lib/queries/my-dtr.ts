import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

// ── Types ──────────────────────────────────────────────────────────

export interface MyDTREntry {
  id: string;
  url: string;
  remarks: string;
  task: string;
  hours: number;
  minutes: number;
  date: string | null;
  lawyerName: string;
  withIds: string[];
  withNames: string[];
  matterId: string | null;
  matterName: string;
  clientName: string;
  lastEditedAt: string | null;
}

// ── Queries ────────────────────────────────────────────────────────

/** A value inside a PostgREST `or(...)` filter, quoted so commas and parentheses in it stay literal. */
function postgrestQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * PostgREST `or(...)` for the DTR entries that count as a person's: written by
 * them, or listed in "with". Authorship is `lawyer_person_id`; the name only
 * matches entries the backfill couldn't resolve to anyone.
 */
export function dtrPersonFilter(personId: string, lawyerName: string | null): string {
  const clauses = [`lawyer_person_id.eq.${personId}`, `with_ids.cs.{${personId}}`];
  if (lawyerName) clauses.push(`and(lawyer_person_id.is.null,lawyer_name.eq.${postgrestQuoted(lawyerName)})`);
  return clauses.join(',');
}

/** Resolve a Notion person_id to the lawyer's display name from team. */
export async function getLawyerNameByPersonId(
  firmId: string,
  personId: string,
  db: SupabaseClient = getServiceDbForFirm(firmId),
): Promise<string | null> {
  const { data, error } = await db
    .from('team')
    .select('name')
    .eq('person_id', personId)
    .eq('active', true)
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.name || null;
}

/** Fetch DTR entries where user is the lawyer OR listed in "with" for a specific month. */
export async function getMyDTR(
  firmId: string,
  lawyerName: string,
  personId: string,
  month: string,
  db: SupabaseClient = getServiceDbForFirm(firmId),
): Promise<MyDTREntry[]> {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr);
  const mon = parseInt(monthStr);
  const lastDay = new Date(year, mon, 0).getDate();
  const monthStart = `${yearStr}-${monthStr}-01`;
  const monthEnd = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await db
    .from('dtr')
    .select('notion_id, notion_url, remarks, task, hours, minutes, date, lawyer_name, with_ids, with_names, matter_id, client_name, notion_last_edited_at, matters!left(name)')
    .or(dtrPersonFilter(personId, lawyerName))
    .gte('date', monthStart)
    .lte('date', monthEnd)
    .order('date', { ascending: false })
    .order('notion_last_edited_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.notion_id,
    url: row.notion_url,
    remarks: row.remarks,
    task: row.task,
    hours: row.hours,
    minutes: row.minutes,
    date: row.date,
    lawyerName: row.lawyer_name,
    withIds: row.with_ids ?? [],
    withNames: row.with_names ?? [],
    matterId: row.matter_id ?? null,
    matterName: row.matters?.name ?? '',
    clientName: row.client_name ?? '',
    lastEditedAt: row.notion_last_edited_at,
  }));
}
