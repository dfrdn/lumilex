/**
 * Who edits the firm's rate cards: the roles that own firm-wide published
 * documents. Reading stays open to the whole team — the proposal builder runs
 * as the partner drafting it.
 */
const FEE_SCHEDULE_EDIT_ROLES: ReadonlySet<string> = new Set(['admin', 'super_user', 'finance']);

export function canEditFeeSchedules(role: string | null | undefined): boolean {
  return FEE_SCHEDULE_EDIT_ROLES.has(role ?? '');
}
