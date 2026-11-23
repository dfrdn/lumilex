import type { SupabaseClient } from '@supabase/supabase-js';

// Shared request-body coercion + bundle-reset helpers for the dtr-review
// revision routes (DTR edits and expense edits). Kept in one place so the two
// routes can't drift on parsing rules or the reset-to-pending condition.

export function asString(v: unknown): string | null {
  // Trim defensively so a stray space can't fragment downstream lookups (e.g. client_name).
  return typeof v === 'string' ? v.trim() : null;
}

export function asInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

export function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === 'string')) return null;
  return (v as string[]).map((s) => s.trim());
}

/**
 * Reset an approved/rejected bundle to pending so the managing partner
 * re-reviews after an edit. Skipped when the editor IS the managing partner —
 * they're already the authoritative reviewer. Shared by the DTR + expense
 * revision routes so the reset condition stays identical.
 *
 * Relationship-partner clearance is voided either way, including on an MP edit:
 * clearance signs off the final numbers, so any change to them invalidates it.
 */
export async function resetReviewToPending(
  supabase: SupabaseClient,
  isMP: boolean,
  billingMonth: string,
  clientName: string,
): Promise<void> {
  const clearanceReset = {
    clearance_status: null,
    clearance_notes: '',
    cleared_by: null,
    cleared_at: null,
  };

  if (isMP) {
    await supabase
      .from('dtr_revision_reviews')
      .update(clearanceReset)
      .eq('billing_month', billingMonth)
      .eq('client_name', clientName)
      .not('clearance_status', 'is', null);
    return;
  }

  await supabase
    .from('dtr_revision_reviews')
    .update({ status: 'pending', reviewed_by: null, reviewed_at: null, ...clearanceReset })
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .neq('status', 'pending');
}
