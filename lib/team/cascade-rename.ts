import type { SupabaseClient } from '@supabase/supabase-js';

export interface TeamRenameResult {
  /** `table.column` → rows moved. Only non-zero entries are listed. */
  updated: Record<string, number>;
  /** Set when the cascade failed; nothing moved (it runs in one transaction). */
  error: string | null;
}

/**
 * Propagate a team member's rename to every column that keeps a copy of their
 * name: the DTR author and attendee names, finance revisions, reimbursements,
 * leaves, liaison tasks and Library page bylines.
 *
 * Without this, a rename silently detaches a person from their own history. The
 * one that bites hardest is billing: an attendee is priced by joining `team` on
 * the name, so a stale copy has no position and its hours cannot be priced
 * (lib/billing/lawyer-positions refuses them rather than guess the junior rate).
 *
 * The work is the `cascade_team_rename` RPC
 * (supabase/migrations/20261029_cascade_team_rename_fn.sql): one transaction,
 * every statement filtered to `firmId`, with the matter-activity clock held
 * still, since `.rpc()` passes through getServiceDbForFirm unscoped.
 * `audit_log.performed_by_name` is deliberately not rewritten — it records who
 * acted under the name they had at the time.
 *
 * Call AFTER the `team.name` update has succeeded, on the firm-scoped
 * service-role client: only service_role may execute the function. A failure is
 * logged and returned, never thrown — the rename itself already landed.
 */
export async function cascadeTeamRename(
  supabase: SupabaseClient,
  firmId: string,
  { personId, oldName, newName }: { personId: string; oldName: string; newName: string },
): Promise<TeamRenameResult> {
  if (!oldName || !newName || oldName === newName) return { updated: {}, error: null };

  const { data, error } = await supabase.rpc('cascade_team_rename', {
    p_firm_id: firmId,
    p_person_id: personId,
    p_old_name: oldName,
    p_new_name: newName,
  });
  if (error) {
    console.error('[team-rename] cascade failed:', error.message);
    return { updated: {}, error: error.message };
  }
  return { updated: (data ?? {}) as Record<string, number>, error: null };
}
