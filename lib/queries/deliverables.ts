import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { todayISO } from '@/lib/dates';
import type { NotionDeliverable } from '@/types/notion';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { currentTeamIds, currentOnly, currentReviewers } from '@/lib/queries/people';
import { fetchAllRows } from '@/lib/supabase-paginate';
import { byDueDate } from '@/lib/dashboard-slices';

function mapRow(row: any, current: Set<string>): NotionDeliverable {
  return {
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    matter: row.matter_name,
    matterId: row.matter_id ?? null,
    client: row.client_name,
    status: row.status,
    drafter: currentOnly(row.drafter_ids, current),
    ...currentReviewers(row.reviewer_ids, row.review_dates, current),
    currentlyWith: row.currently_with_ids ?? [],
    externalDueDate: row.external_due_date,
    priority: row.priority,
    type: row.type ?? '',
    createdTime: row.created_time ?? null,
    lastEditedAt: row.notion_last_edited_at ?? null,
  };
}

/** Active filter: not Filed or Archived */
function activeQuery(query: any) {
  return query
    .not('status', 'in', pgInList(CLOSED_STATUSES));
}

/** Filter: user is involved (drafter, reviewer, currently with) */
function personOr(userId: string): string {
  return [
    `drafter_ids.cs.{"${userId}"}`,
    `reviewer_ids.cs.{"${userId}"}`,
    `currently_with_ids.cs.{"${userId}"}`,
  ].join(',');
}

const DELIVERABLE_COLS = 'notion_id, notion_url, name, matter_name, matter_id, client_name, status, drafter_ids, reviewer_ids, currently_with_ids, external_due_date, review_dates, priority, type, created_time, notion_last_edited_at';

/** Deliverables currently with the user — pending their action */
export async function getSubmissions(firmId: string, userId: string): Promise<NotionDeliverable[]> {
  const supabase = getServiceDbForFirm(firmId);
  let query = supabase
    .from('deliverables')
    .select(DELIVERABLE_COLS)
    .contains('currently_with_ids', [userId]);
  query = activeQuery(query);
  const { data, error } = await query
    .order('external_due_date', { ascending: true })
    .limit(50);

  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapRow(r, current));
}

/** Deliverables filtered by status — used by the by-status page */
export async function getDeliverablesByStatus(firmId: string, status: string): Promise<NotionDeliverable[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverables')
    .select(DELIVERABLE_COLS)
    .eq('status', status)
    .order('external_due_date', { ascending: true })
    .limit(200);

  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapRow(r, current));
}

/** Every active deliverable the user is involved in (drafter, reviewer, or currently with), by deadline */
export async function getTeamDeliverables(
  firmId: string,
  userId: string,
  db: SupabaseClient = getServiceDbForFirm(firmId),
): Promise<NotionDeliverable[]> {
  const rows = await fetchAllRows((from, to) =>
    activeQuery(
      db
        .from('deliverables')
        .select(DELIVERABLE_COLS)
        .or(personOr(userId)),
    )
      .order('notion_id')
      .range(from, to));

  const current = await currentTeamIds(firmId);
  return rows.map((r) => mapRow(r, current)).sort(byDueDate);
}

/** Firm-wide: all active deliverables due today (no user filter) */
export async function getDeliverablesTodayFirm(firmId: string): Promise<NotionDeliverable[]> {
  const today = todayISO();
  const supabase = getServiceDbForFirm(firmId);
  let query = supabase.from('deliverables').select(DELIVERABLE_COLS);
  query = activeQuery(query);
  const { data, error } = await query
    .or(`external_due_date.eq.${today},review_dates.cs.{"${today}"}`)
    .order('external_due_date', { ascending: true })
    .limit(200);

  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapRow(r, current));
}

/** Firm-wide: all active deliverables (no user filter) */
export async function getActiveDeliverablesFirm(firmId: string): Promise<NotionDeliverable[]> {
  const supabase = getServiceDbForFirm(firmId);
  let query = supabase.from('deliverables').select(DELIVERABLE_COLS);
  query = activeQuery(query);
  const { data, error } = await query
    .order('external_due_date', { ascending: true })
    .limit(300);

  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapRow(r, current));
}

/** Firm-wide: all active deliverables overdue (no user filter) */
export async function getBacklogsFirm(firmId: string): Promise<NotionDeliverable[]> {
  const today = todayISO();
  const supabase = getServiceDbForFirm(firmId);
  let query = supabase.from('deliverables').select(DELIVERABLE_COLS);
  query = activeQuery(query);
  const { data, error } = await query
    .lt('external_due_date', today)
    .order('external_due_date', { ascending: true })
    .limit(200);

  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapRow(r, current));
}
