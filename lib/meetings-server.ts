import type { SupabaseClient } from '@supabase/supabase-js';
import { quorumError } from './meeting-quorum';
import type { CreateMeetingInput } from './validation';

/**
 * Run the cross-record quorum check against live corporation data (director
 * head count + outstanding shares). Returns an error message or null.
 * Shared by the create (POST) and edit (PATCH) meeting handlers.
 */
export async function meetingQuorumError(
  supabase: SupabaseClient,
  corporationId: string,
  m: CreateMeetingInput,
): Promise<string | null> {
  if (!m.quorumAchieved) return null;
  const [{ count }, { data: corp }] = await Promise.all([
    supabase
      .from('corporation_persons')
      .select('id', { count: 'exact', head: true })
      .eq('corporation_id', corporationId)
      .eq('role', 'Director')
      .eq('is_current', true),
    supabase.from('corporations').select('number_of_shares').eq('id', corporationId).maybeSingle(),
  ]);
  return quorumError(m, {
    totalDirectors: count ?? 0,
    corporationShares: (corp?.number_of_shares as number | null) ?? null,
  });
}

/** Map a validated meeting payload to its `corporation_meetings` column object. */
export function meetingToColumns(m: CreateMeetingInput): Record<string, unknown> {
  return {
    meeting_type: m.meetingType,
    meeting_date: m.meetingDate,
    meeting_time: m.meetingTime ?? null,
    meeting_mode: m.meetingMode,
    venue: m.venue,
    notice_sent_date: m.noticeSentDate ?? null,
    quorum_achieved: m.quorumAchieved,
    shares_represented: m.sharesRepresented ?? null,
    total_shares_outstanding: m.totalSharesOutstanding ?? null,
    agenda: m.agenda,
    attendees: m.attendees,
    notes: m.notes ?? null,
  };
}
