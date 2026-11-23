import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { todayISO, thisWeekRange } from '@/lib/dates';
import type { NotionTask } from '@/types/notion';
import { fetchAllRows } from '@/lib/supabase-paginate';
import { byPriority } from '@/lib/dashboard-slices';

function mapRow(row: any): NotionTask {
  return {
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    matter: row.matter_name,
    dueDate: row.due_date,
    status: row.status,
    priority: row.priority,
    done: row.done,
  };
}

export async function getTasksToday(firmId: string, userId: string): Promise<NotionTask[]> {
  const today = todayISO();
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('tasks')
    .select('notion_id, notion_url, name, matter_name, due_date, status, priority, done, assignee_ids')
    .contains('assignee_ids', [userId])
    .eq('due_date', today)
    .eq('done', false);

  if (error) throw error;
  return (data ?? []).map(mapRow).sort(byPriority);
}

export async function getTasksThisWeek(firmId: string, userId: string): Promise<NotionTask[]> {
  const { start, end } = thisWeekRange();
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('tasks')
    .select('notion_id, notion_url, name, matter_name, due_date, status, priority, done, assignee_ids')
    .contains('assignee_ids', [userId])
    .gte('due_date', start)
    .lte('due_date', end)
    .eq('done', false)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getTasksForWeek(firmId: string, userId: string, start: string, end: string): Promise<NotionTask[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('tasks')
    .select('notion_id, notion_url, name, matter_name, due_date, status, priority, done, assignee_ids')
    .contains('assignee_ids', [userId])
    .gte('due_date', start)
    .lte('due_date', end)
    .eq('done', false)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** All open tasks for a user (no date filter) — overdue + upcoming, by due date with undated last */
export async function getOpenTasks(
  firmId: string,
  userId: string,
  db: SupabaseClient = getServiceDbForFirm(firmId),
): Promise<NotionTask[]> {
  const rows = await fetchAllRows((from, to) =>
    db
      .from('tasks')
      .select('notion_id, notion_url, name, matter_name, due_date, status, priority, done, assignee_ids')
      .contains('assignee_ids', [userId])
      .eq('done', false)
      .order('notion_id')
      .range(from, to));

  return rows
    .map(mapRow)
    .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'));
}
