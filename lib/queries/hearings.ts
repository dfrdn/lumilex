import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { manilaDayEnd, manilaDayStart, thisWeekRange } from '@/lib/dates';
import type { NotionHearing } from '@/types/notion';
import { currentTeamIds, currentOnly } from '@/lib/queries/people';

function mapRow(row: any, current: Set<string>): NotionHearing {
  return {
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    date: row.date,
    matter: row.matter_name,
    matterId: row.matter_id ?? null,
    type: row.type,
    status: row.status,
    isAttended: row.is_attended ?? false,
    attendeeIds: currentOnly(row.attendee_ids, current),
  };
}

/** This week's hearings — optionally filtered by attendee */
export async function getHearingsThisWeek(firmId: string, userId?: string): Promise<NotionHearing[]> {
  const { start, end } = thisWeekRange();
  return getHearingsForWeek(firmId, start, end, userId);
}

/** Hearings for a given week range — optionally filtered by attendee */
export async function getHearingsForWeek(firmId: string, start: string, end: string, userId?: string): Promise<NotionHearing[]> {
  const supabase = getServiceDbForFirm(firmId);
  let query = supabase
    .from('hearings')
    .select('notion_id, notion_url, name, date, matter_name, matter_id, type, status, is_attended, attendee_ids')
    .neq('type', 'Filing')
    .gte('date', manilaDayStart(start))
    .lte('date', manilaDayEnd(end));

  if (userId) query = query.contains('attendee_ids', [userId]);

  const { data, error } = await query.order('date', { ascending: true });
  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapRow(r, current));
}
