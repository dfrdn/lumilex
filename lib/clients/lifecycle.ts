/**
 * Client lifecycle, derived purely from the client's matters (always fresh, no
 * manual upkeep). This is the same rule the DB enforces firm-wide on
 * clients.status via the matters→clients trigger (recalc_client_status):
 *
 *   - no matters at all        → Prospective  (still in the prospects cycle)
 *   - ≥1 active (Ongoing) matter → Active
 *   - has matters, none active  → Inactive
 *
 * A client leaves Prospective the moment any matter exists and never returns to
 * it; Active ⇄ Inactive flips automatically as matters open and close.
 */
export type ClientLifecycle = 'Prospective' | 'Active' | 'Inactive';

export function deriveClientLifecycle(matterCount: number, activeMatterCount: number): ClientLifecycle {
  if (matterCount === 0) return 'Prospective';
  return activeMatterCount > 0 ? 'Active' : 'Inactive';
}

/** A matter is "active" when its status is Ongoing (Active is normalized to Ongoing). */
export const ACTIVE_MATTER_STATUSES = new Set(['ongoing', 'active']);

export function isActiveMatterStatus(status: string | null | undefined): boolean {
  return ACTIVE_MATTER_STATUSES.has((status ?? '').toLowerCase());
}

/** Display order: most-engaged first. */
export const LIFECYCLE_ORDER: ClientLifecycle[] = ['Active', 'Prospective', 'Inactive'];

export const LIFECYCLE_BADGE: Record<ClientLifecycle, string> = {
  Active: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20',
  Prospective: 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20',
  Inactive: 'bg-stone-100 text-stone-500 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20',
};
