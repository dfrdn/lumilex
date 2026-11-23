import type { SupabaseClient } from '@supabase/supabase-js';
import { rowToCorporation } from '@/lib/corporation-row';
import { isFiled, yearOf } from '@/lib/corporations/filing-history';
import { loadFilingCalendar } from '@/lib/corporations/filing-calendar';
import { dueDateInfo, obligationOfDeliverable } from '@/lib/corporations/obligations';
import { fetchAllRows } from '@/lib/supabase-paginate';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

export interface RedateChange {
  notionId: string;
  name: string;
  from: string | null;
  to: string;
}

/**
 * Bring open AFS or ITR filings for one filing year onto the filing calendar.
 *
 * When the SEC moves a deadline (MC No. 9-2026's 29 May, then the 15 June
 * extension), every company's open filing for that year carries the old
 * date until someone edits each by hand. This finds them — December
 * year-end companies, not yet filed, not archived — and, unless `dryRun`,
 * moves each to the date the calendar now gives.
 *
 * Runs on the caller's client; deliverables are writable by any staff member.
 */
export async function redateOpenFilings(
  supabase: SupabaseClient,
  { obligation, filingYear, dryRun }: { obligation: 'afs' | 'itr'; filingYear: number; dryRun: boolean },
): Promise<RedateChange[]> {
  const fy = filingYear - 1;
  const [calendar, corpRows] = await Promise.all([
    loadFilingCalendar(supabase),
    fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase
        .from('corporations')
        .select(CORPORATION_SELECT)
        .eq('fiscal_year_end_month', 12)
        .neq('status', 'Dissolved')
        .order('id')
        .range(from, to),
    ),
  ]);
  const corps = new Map(corpRows.map((r) => {
    const c = rowToCorporation(r as Record<string, unknown>);
    return [c.id, c] as const;
  }));
  if (!corps.size) return [];

  // Batches of companies keep each `in (...)` filter a sensible size.
  const ids = [...corps.keys()];
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    rows.push(
      ...(await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from('deliverables')
          .select('notion_id, subject_id, type, name, external_due_date, status')
          .in('subject_id', chunk)
          .eq('type', obligation === 'afs' ? 'SEC AFS' : 'BIR Filing')
          .order('notion_id')
          .range(from, to),
      )),
    );
  }

  const changes: RedateChange[] = [];
  for (const d of rows) {
    const status = (d.status as string) ?? '';
    if (isFiled(status) || status === DELIVERABLE_STATUS.ARCHIVED) continue;
    const name = (d.name as string) ?? '';
    if (obligationOfDeliverable({ type: d.type as string, name }) !== obligation) continue;
    const from = (d.external_due_date as string | null) ?? null;
    if (yearOf({ notionId: '', name, type: d.type as string, externalDueDate: from, status }) !== fy) continue;
    const corp = corps.get(d.subject_id as string);
    if (!corp) continue;
    const to = dueDateInfo(obligation, fy, { corporation: corp, calendar }).date;
    if (to && to !== from) changes.push({ notionId: d.notion_id as string, name, from, to });
  }

  if (!dryRun) {
    // One update per target date (every company usually moves to the same
    // one), in chunks, rather than one round trip per filing.
    const byDate = new Map<string, string[]>();
    for (const c of changes) byDate.set(c.to, [...(byDate.get(c.to) ?? []), c.notionId]);
    for (const [to, ids] of byDate) {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase.from('deliverables').update({ external_due_date: to }).in('notion_id', ids.slice(i, i + 200));
        if (error) throw new Error(`Re-dating filings to ${to} failed: ${error.message}`);
      }
    }
  }
  return changes;
}
