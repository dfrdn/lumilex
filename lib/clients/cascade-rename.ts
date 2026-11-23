import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tables that store a denormalized copy of the client's name, matched and
 * updated by the OLD name. `matters` (updated by its stable `client_id` FK) and
 * `dtr_revision_reviews` (collision-handled separately) are NOT in this list.
 *
 * Kept in sync with the `client_name` columns in the live schema; re-derive with
 * `select table_name from information_schema.columns where column_name='client_name'`.
 */
const CLIENT_NAME_TABLES = [
  'client_deposits',
  'deliverables',
  'dtr',
  'dtr_revisions',
  'expense_revisions',
  'generated_documents',
  'invoices',
  'liaison_tasks',
  'reimbursements',
  'trademarks',
] as const;

export interface CascadeRenameResult {
  /** Billing months whose review bundle could NOT be moved because the new name
   *  already owns a bundle for that month (UNIQUE collision) — needs a manual merge. */
  reviewCollisions: string[];
}

/**
 * Propagate a client rename to every table that denormalizes `client_name`.
 *
 * Without this, the finance Review (which groups billing bundles by the
 * `client_name` string), invoices, the deposit ledger, DTRs, expense edits, etc.
 * keep the old name and a single client splits into stale "old name" and live
 * "new name" bundles. Call AFTER the `clients.name` update has succeeded, and on
 * the SERVICE-ROLE client so RLS can't silently drop a finance-table update.
 *
 * Logs per-table failures without throwing. `dtr_revision_reviews` has
 * UNIQUE(billing_month, client_name): months that don't collide are still moved;
 * colliding months are left in place and returned in `reviewCollisions` for a
 * manual merge (a single collision no longer blocks the rest of the rename).
 */
export async function cascadeClientRename(
  supabase: SupabaseClient,
  { clientId, oldName, newName }: { clientId: string; oldName: string; newName: string },
): Promise<CascadeRenameResult> {
  if (!newName || !oldName || newName === oldName) return { reviewCollisions: [] };

  const { error: matterErr } = await supabase
    .from('matters')
    .update({ client_name: newName })
    .eq('client_id', clientId);
  if (matterErr) console.error('[client-rename] matters cascade failed:', matterErr.message);

  await Promise.all(
    CLIENT_NAME_TABLES.map(async (table) => {
      const { error } = await supabase
        .from(table)
        .update({ client_name: newName })
        .eq('client_name', oldName);
      if (error) console.error(`[client-rename] ${table} cascade failed:`, error.message);
    }),
  );

  // dtr_revision_reviews has UNIQUE(billing_month, client_name): a blanket rename
  // throws (and rolls back the whole statement) the moment ONE month collides
  // with an existing bundle under the new name. Move only the non-colliding
  // months; report the rest for a manual merge.
  const reviewCollisions: string[] = [];
  const [{ data: oldRows }, { data: newRows }] = await Promise.all([
    supabase.from('dtr_revision_reviews').select('billing_month').eq('client_name', oldName),
    supabase.from('dtr_revision_reviews').select('billing_month').eq('client_name', newName),
  ]);
  const newMonths = new Set((newRows ?? []).map((r) => r.billing_month as string));
  const safeMonths: string[] = [];
  for (const r of oldRows ?? []) {
    const month = r.billing_month as string;
    if (newMonths.has(month)) reviewCollisions.push(month);
    else safeMonths.push(month);
  }
  if (safeMonths.length > 0) {
    const { error } = await supabase
      .from('dtr_revision_reviews')
      .update({ client_name: newName })
      .eq('client_name', oldName)
      .in('billing_month', safeMonths);
    if (error) console.error('[client-rename] dtr_revision_reviews cascade failed:', error.message);
  }
  if (reviewCollisions.length > 0) {
    console.error(
      `[client-rename] ${reviewCollisions.length} review bundle(s) for "${oldName}"→"${newName}" `
        + `collide with existing bundles (months: ${reviewCollisions.join(', ')}); left stale for manual merge.`,
    );
  }

  return { reviewCollisions };
}
