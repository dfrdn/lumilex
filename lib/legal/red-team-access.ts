import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

// Authorization helpers for Red Team. `pleading_red_teams` is RLS-on-no-policy
// (service-role only), so every handler that touches it has to make the access
// decision itself against a policy-backed table.

/**
 * Whether the caller may read a matter, decided by RLS rather than by role.
 *
 * This gate matters more here than on the other AI surfaces: Red Team does not
 * merely tag a run with its matter, it feeds the matter id to
 * assembleDraftGrounding, which reads the matter brief and the matter's own
 * documents with the SERVICE-ROLE client. An unchecked matter id is therefore a
 * cross-matter read of privileged material, not just a mislabelled row.
 */
export async function canAccessMatter(matterId: string): Promise<boolean> {
  const authed = await getSupabaseServerAuthClient();
  const { data } = await authed
    .from('matters')
    .select('notion_id')
    .eq('notion_id', matterId)
    .maybeSingle();
  return !!data;
}

/**
 * Whether the caller may see a red-team run: they started it, they are
 * privileged, or RLS grants them the run's matter. Returns the run's matter_id
 * so callers can avoid a second read.
 */
export async function canAccessRun(
  firmId: string,
  redTeamId: number | string,
  personId: string,
  role: string,
): Promise<{ allowed: boolean; matterId: string | null; exists: boolean }> {
  const service = getServiceDbForFirm(firmId);
  const { data: run } = await service
    .from('pleading_red_teams')
    .select('reviewed_by, matter_id')
    .eq('id', redTeamId)
    .maybeSingle();
  if (!run) return { allowed: false, matterId: null, exists: false };

  const isPrivileged = role === 'partner' || role === 'admin' || role === 'super_user';
  if (run.reviewed_by === personId || isPrivileged) {
    return { allowed: true, matterId: run.matter_id ?? null, exists: true };
  }
  // A colleague's run on a matter the caller works is fair game; a run on a
  // matter they cannot see is not.
  const allowed = run.matter_id ? await canAccessMatter(run.matter_id) : false;
  return { allowed, matterId: run.matter_id ?? null, exists: true };
}
