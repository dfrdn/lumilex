import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { thisWeekRange } from '@/lib/dates';
import type { NotionFiling } from '@/types/notion';
import { fetchAllRows, fetchAllRowsIn } from '@/lib/supabase-paginate';

/**
 * Filings are deliverables with an external_due_date that belong to
 * case matters (matters with case_title, case_number, or court set).
 */

const FILING_COLS = 'notion_id, notion_url, name, external_due_date, matter_name, matter_id, status, currently_with_ids';

/**
 * Keep the rows on case matters. The date filter bounds `rows`, so this looks
 * up only their matters, never the whole book of case matters.
 */
async function onCaseMatters<T extends { matter_id: string | null }>(firmId: string, rows: T[]): Promise<T[]> {
  const matterIds = [...new Set(rows.map((r) => r.matter_id).filter((id): id is string => !!id))];
  if (matterIds.length === 0) return [];

  const supabase = getServiceDbForFirm(firmId);
  const caseMatters = await fetchAllRowsIn<{ notion_id: string }>(matterIds, (ids, from, to) =>
    supabase
      .from('matters')
      .select('notion_id')
      .in('notion_id', ids)
      .or('case_title.neq.,case_number.neq.,court.neq.')
      .order('notion_id')
      .range(from, to),
  );
  const caseIds = new Set(caseMatters.map((m) => m.notion_id));
  return rows.filter((r) => r.matter_id && caseIds.has(r.matter_id));
}

/** External deliverables due within [start, end], optionally currently with `userId`, on case matters. */
async function filingsBetween(firmId: string, start: string, end: string, userId?: string): Promise<NotionFiling[]> {
  const supabase = getServiceDbForFirm(firmId);
  const rows = await fetchAllRows<Record<string, unknown> & { matter_id: string | null }>((from, to) => {
    let query = supabase
      .from('deliverables')
      .select(FILING_COLS)
      .eq('type', 'External')
      .gte('external_due_date', start)
      .lte('external_due_date', end);
    if (userId) query = query.contains('currently_with_ids', [userId]);
    return query.order('notion_id').range(from, to);
  });

  const filings = await onCaseMatters(firmId, rows);
  return filings
    .map(mapRow)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

function mapRow(row: Record<string, unknown>): NotionFiling {
  return {
    id: row.notion_id as string,
    url: row.notion_url as string ?? '',
    name: row.name as string,
    date: row.external_due_date as string | null,
    matter: row.matter_name as string ?? '',
    matterId: row.matter_id as string | null ?? null,
    status: row.status as string ?? '',
    attendeeIds: (row.currently_with_ids as string[]) ?? [],
  };
}

/** This week's filings — optionally filtered by currently_with */
export async function getFilingsThisWeek(firmId: string, userId?: string): Promise<NotionFiling[]> {
  const { start, end } = thisWeekRange();
  return getFilingsForWeek(firmId, start, end, userId);
}

/** Filings for a given week range — optionally filtered by currently_with */
export async function getFilingsForWeek(firmId: string, start: string, end: string, userId?: string): Promise<NotionFiling[]> {
  return filingsBetween(firmId, start, end, userId);
}
