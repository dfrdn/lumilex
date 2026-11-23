import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { manilaDayEnd, manilaDayStart, thisWeekRange } from '@/lib/dates';
import type { NotionMeeting } from '@/types/notion';
import { currentTeamIds, currentOnly } from '@/lib/queries/people';

function mapRow(row: any, current: Set<string>): NotionMeeting {
  return {
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    date: row.date_start,
    endDate: row.date_end,
    matter: row.matter_name,
    matterId: row.matter_id ?? null,
    type: row.type,
    isAttended: row.is_attended,
    attendeeIds: currentOnly(row.attendee_ids, current),
  };
}

export async function getFirmMeetingsThisWeek(firmId: string): Promise<NotionMeeting[]> {
  const { start, end } = thisWeekRange();
  return getFirmMeetingsForWeek(firmId, start, end);
}

export async function getMeetingsForWeek(firmId: string, userId: string, start: string, end: string): Promise<NotionMeeting[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('meetings')
    .select('notion_id, notion_url, name, date_start, date_end, matter_name, matter_id, type, is_attended, attendee_ids')
    .contains('attendee_ids', [userId])
    .gte('date_start', start)
    .lte('date_start', `${end}T23:59:59`)
    .order('date_start', { ascending: true });

  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapRow(r, current));
}

export async function getFirmMeetingsForWeek(firmId: string, start: string, end: string): Promise<NotionMeeting[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('meetings')
    .select('notion_id, notion_url, name, date_start, date_end, matter_name, matter_id, type, is_attended, attendee_ids')
    .gte('date_start', manilaDayStart(start))
    .lte('date_start', manilaDayEnd(end))
    .order('date_start', { ascending: true });

  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapRow(r, current));
}
