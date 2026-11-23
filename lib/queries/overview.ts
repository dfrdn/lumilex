import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { toDecimal } from '@/lib/dtr-utils';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { monthRange } from '@/lib/dates';
import { dtrPersonFilter } from '@/lib/queries/my-dtr';

export interface UserOverview {
  name: string;
  initials: string;
  position: string;
  /** Decimal hours using 0.1 = 6-minute increments (ceiling). */
  totalHoursThisMonth: number;
  activeMatterCount: number;
  /** null when the caller asked not to count (it holds the list itself). */
  pendingDeliverables: number | null;
}

/**
 * `userName` is the team row's name (the session's, or the selected lawyer's):
 * the DTR fallback for entries with no lawyer_person_id. Every read runs at
 * once. Pass `countPending: false` when the caller already holds that list.
 */
export async function getUserOverview(
  firmId: string,
  userId: string,
  userName: string,
  { countPending = true, db = getServiceDbForFirm(firmId) }: { countPending?: boolean; db?: SupabaseClient } = {},
): Promise<UserOverview | null> {
  const { start: monthStart, end: monthEnd } = monthRange();

  const [teamResult, dtrResult, mattersResult, pendingResult] = await Promise.all([
    db
      .from('team')
      .select('name, initials, position')
      .eq('person_id', userId)
      .eq('active', true)
      .limit(1)
      .maybeSingle(),
    db
      .from('dtr')
      .select('hours, minutes')
      .or(dtrPersonFilter(userId, userName || null))
      .gte('date', monthStart)
      .lte('date', monthEnd),
    db
      .from('matters')
      .select('notion_id', { count: 'exact', head: true })
      .contains('team_person_ids', [userId])
      .eq('status', 'Ongoing'),
    !countPending
      ? Promise.resolve({ count: null, error: null })
      : db
          .from('deliverables')
          .select('notion_id', { count: 'exact', head: true })
          .contains('currently_with_ids', [userId])
          .not('status', 'in', pgInList(CLOSED_STATUSES)),
  ]);

  // A failed count must not read as zero: throw, and the caller shows it as not loaded.
  if (teamResult.error) throw teamResult.error;
  if (dtrResult.error) throw dtrResult.error;
  if (mattersResult.error) throw mattersResult.error;
  if (pendingResult.error) throw pendingResult.error;

  const teamRow = teamResult.data;
  if (!teamRow) return null;

  let totalDecimal = 0;
  for (const row of dtrResult.data ?? []) {
    totalDecimal += toDecimal(row.hours ?? 0, row.minutes ?? 0);
  }

  return {
    name: teamRow.name ?? '',
    initials: teamRow.initials ?? '',
    position: teamRow.position ?? '',
    totalHoursThisMonth: totalDecimal,
    activeMatterCount: mattersResult.count ?? 0,
    pendingDeliverables: countPending ? (pendingResult.count ?? 0) : null,
  };
}
