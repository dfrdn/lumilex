/**
 * Roll back generated invoices: reverse everything persistInvoice() did, then
 * delete the row. Mirrors the flag-reversal logic in lib/billing/persist-invoice.ts
 * (the isRegenerate branch) so DTRs / reimbursements / matter_expenses / action
 * entries / milestones / acceptance flags all return to their pre-invoice state.
 *
 *   - unflag dtr.billed, reimbursements.reimbursed, matter_expenses.billed
 *   - unflag matter_action_entries.invoiced, matter_billing_milestones.invoiced
 *   - clear acceptance_fee_paid on the invoice's acceptance matters
 *   - delete the DOCX/XLSX/PDF/breakdown objects from storage
 *   - delete the invoices row
 *   - reset dtr_revision_reviews back to invoice_gen_status='failed'
 *   - floor the per-month counter at the real max remaining (reclaims trailing slots)
 *
 * (The OneDrive/SharePoint mirror copy is best-effort on generate and is left
 * in place — it is not referenced once the row is gone.)
 *
 * Run: npx tsx scripts/rollback-invoices.ts ABC-2026-05-031 ABC-2026-05-034 ...
 */
import './load-env';
import { getSupabase } from '@/lib/supabase';

const invoiceNumbers = process.argv.slice(2);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dtrIds = (items: any[]): string[] =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (items ?? []).flatMap((l: any) => (l.entries ?? []).map((e: any) => e.rawDtrId ?? e.id)).filter(Boolean);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reimbIds = (items: any[]): string[] =>
  (items ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.source === 'reimbursement' || !e.source)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => e.id)
    .filter((id: string) => id && !String(id).startsWith('mexp-'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mexpIds = (items: any[]): number[] =>
  (items ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.source === 'finance' || (e.id && String(e.id).startsWith('mexp-')))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => parseInt(String(e.id).replace('mexp-', '')))
    .filter((id: number) => !isNaN(id));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byKind = (items: any[], kind: string): any[] => (items ?? []).filter((f: any) => f && f.kind === kind);

async function main() {
  if (invoiceNumbers.length === 0) {
    console.error('Usage: npx tsx scripts/rollback-invoices.ts <INVOICE_NUMBER> [...]');
    process.exit(1);
  }
  const supabase = getSupabase();
  // billing month -> the invoice-number prefix its numbers were minted under
  const months = new Map<string, string>();

  for (const invoiceNumber of invoiceNumbers) {
    console.log(`\n→ ${invoiceNumber}`);
    const { data: inv, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('invoice_number', invoiceNumber)
      .maybeSingle();
    if (error) throw error;
    if (!inv) {
      console.log('  not found — skipping');
      continue;
    }
    months.set(inv.billing_month, inv.invoice_number.replace(/-\d{4}-\d{2}-\d+$/, ''));

    // ── Reverse flags ──────────────────────────────────────────────────────
    const d = dtrIds(inv.line_items);
    if (d.length) {
      const { error: e } = await supabase.from('dtr').update({ billed: false }).in('notion_id', d);
      console.log(`  dtr.billed=false ×${d.length}${e ? ' ERR ' + e.message : ''}`);
    }
    const r = reimbIds(inv.expense_items);
    if (r.length) {
      const { error: e } = await supabase.from('reimbursements').update({ reimbursed: false }).in('notion_id', r);
      console.log(`  reimbursements.reimbursed=false ×${r.length}${e ? ' ERR ' + e.message : ''}`);
    }
    const me = mexpIds(inv.expense_items);
    if (me.length) {
      const { error: e } = await supabase.from('matter_expenses').update({ billed: false, invoice_id: null }).in('id', me);
      console.log(`  matter_expenses.billed=false ×${me.length}${e ? ' ERR ' + e.message : ''}`);
    }
    const actIds = byKind(inv.fee_lines, 'action').flatMap((f) => f.sourceIds ?? []).filter((x) => typeof x === 'number');
    if (actIds.length) {
      const { error: e } = await supabase.from('matter_action_entries').update({ invoiced: false, invoice_id: null }).in('id', actIds);
      console.log(`  matter_action_entries.invoiced=false ×${actIds.length}${e ? ' ERR ' + e.message : ''}`);
    }
    const msIds = byKind(inv.fee_lines, 'milestone').flatMap((f) => f.sourceIds ?? []).filter((x) => typeof x === 'number');
    if (msIds.length) {
      const { error: e } = await supabase.from('matter_billing_milestones').update({ invoiced: false, invoice_id: null }).in('id', msIds);
      console.log(`  matter_billing_milestones.invoiced=false ×${msIds.length}${e ? ' ERR ' + e.message : ''}`);
    }
    const accMatters = byKind(inv.fee_lines, 'acceptance').map((f) => f.matterId).filter(Boolean);
    if (accMatters.length) {
      const { error: e } = await supabase.from('matter_billing_configs').update({ acceptance_fee_paid: false }).in('matter_id', accMatters);
      console.log(`  acceptance_fee_paid=false ×${accMatters.length}${e ? ' ERR ' + e.message : ''}`);
    }

    // ── Delete storage objects ─────────────────────────────────────────────
    const paths = [inv.docx_storage_path, inv.xlsx_storage_path, inv.pdf_storage_path, inv.breakdown_pdf_storage_path].filter(Boolean);
    if (paths.length) {
      const { error: e } = await supabase.storage.from('files').remove(paths);
      console.log(`  storage removed ×${paths.length}${e ? ' ERR ' + e.message : ''}`);
    }

    // ── Delete the row ─────────────────────────────────────────────────────
    const { error: delErr } = await supabase.from('invoices').delete().eq('id', inv.id);
    if (delErr) throw delErr;
    console.log('  invoices row deleted');

    // ── Restore the review row so it shows as needing regeneration ─────────
    const { error: revErr } = await supabase
      .from('dtr_revision_reviews')
      .update({
        invoice_gen_status: 'failed',
        invoice_gen_error: 'Rolled back for VAT letter fix — regenerate after fix',
        invoice_gen_invoice_id: null,
        invoice_gen_invoice_number: null,
      })
      .eq('billing_month', inv.billing_month)
      .eq('client_name', inv.client_name);
    console.log(`  review → failed${revErr ? ' ERR ' + revErr.message : ''}`);
  }

  // ── Floor each touched month's counter at the real max remaining ──────────
  for (const [month, prefix] of months) {
    const { data: rows } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('billing_month', month)
      .like('invoice_number', `${prefix}-${month}-%`);
    let maxSeq = 0;
    for (const row of rows ?? []) {
      const m = /(\d+)$/.exec(row.invoice_number);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1]));
    }
    const { error } = await supabase
      .from('invoice_number_counters')
      .update({ last_seq: maxSeq })
      .eq('billing_month', month);
    console.log(`\nCounter ${month} floored to ${maxSeq}${error ? ' ERR ' + error.message : ''}`);
  }

  console.log('\nRollback complete.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
