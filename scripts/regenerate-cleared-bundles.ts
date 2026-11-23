/**
 * Generates the invoice for bundles that carry both signatures but no invoice.
 *
 * Clearance auto-generation used to run on the clearing partner's own client,
 * where the billing tables are invisible under RLS and the invoice INSERT is
 * refused — so a cleared bundle recorded `skipped` (bundle read as empty) or
 * `failed` (42501) and produced nothing. The route now runs service-role; this
 * sweeps up the bundles stranded before that fix.
 *
 * Usage:
 *   npx tsx scripts/regenerate-cleared-bundles.ts --firm <uuid>          # dry run
 *   npx tsx scripts/regenerate-cleared-bundles.ts --firm <uuid> --apply  # generate
 *
 * Only touches rows that are approved AND cleared AND have no invoice for that
 * client + month. A bundle whose invoice already exists is left alone — this
 * never regenerates over finance's work.
 */

// FIRST — imports are hoisted, and lib/microsoft-graph.ts reads its credentials
// at module scope. Load env inline here and Graph is already unconfigured by the
// time this line runs: the letter silently falls back to the local renderer and
// the invoice lands with no PDF.
import './load-env';

import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { generateBundleInvoice } from '../lib/billing/generate-bundle-invoice';

const apply = process.argv.includes('--apply');

const firmFlag = process.argv.indexOf('--firm');
const firmId = firmFlag !== -1 ? process.argv[firmFlag + 1] : undefined;
if (!firmId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(firmId)) {
  console.error('Usage: npx tsx scripts/regenerate-cleared-bundles.ts --firm <uuid> [--apply]');
  process.exit(1);
}

// Not a person: this run is the deferred half of a clearance already signed, and
// the ledger shouldn't name someone who didn't click. Also the marker that lets
// a re-run repair its own output without touching finance's.
const GENERATED_BY = 'rp-auto-gen-backfill';

async function main() {
  const supabase = getServiceDbForFirm(firmId!);

  const { data: reviews, error } = await supabase
    .from('dtr_revision_reviews')
    .select('id, billing_month, client_name, invoice_gen_status, invoice_gen_invoice_number, invoice_settings_override, cleared_at')
    .eq('status', 'approved')
    .eq('clearance_status', 'cleared')
    .order('cleared_at', { ascending: true });
  if (error) throw new Error(error.message);

  const candidates: { review: NonNullable<typeof reviews>[number]; why: string }[] = [];
  for (const r of reviews ?? []) {
    const { data: existing } = await supabase
      .from('invoices')
      .select('id, invoice_number, generated_by, pdf_storage_path')
      .eq('client_name', r.client_name)
      .eq('billing_month', r.billing_month)
      .maybeSingle();

    if (!existing) {
      // A recorded invoice number with no row behind it means the invoice was
      // generated once and deleted since. Somebody chose that; don't undo it.
      if (r.invoice_gen_invoice_number) {
        console.log(
          `skip  ${r.billing_month} ${r.client_name} — ${r.invoice_gen_invoice_number} was generated, then deleted`,
        );
        continue;
      }
      candidates.push({ review: r, why: `no invoice (gen: ${r.invoice_gen_status ?? 'never ran'})` });
      continue;
    }
    // An invoice a person generated is finance's work — never regenerate over
    // it. This script's own output is fair game: a run that couldn't reach Graph
    // leaves the letter PDF missing, and a re-run repairs it in place (same
    // number, and a never-sent draft doesn't count as a revision).
    if (existing.generated_by === GENERATED_BY && !existing.pdf_storage_path) {
      candidates.push({ review: r, why: `${existing.invoice_number} has no letter PDF` });
    }
  }

  console.log(`\n${candidates.length} bundle(s) needing generation:`);
  for (const { review: r, why } of candidates) {
    console.log(`  ${r.billing_month}  ${r.client_name}  — ${why}`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to generate.');
    return;
  }

  console.log('');
  for (const { review: r } of candidates) {
    const override = (r.invoice_settings_override ?? null) as Record<string, unknown> | null;
    let result;
    try {
      result = await generateBundleInvoice({
        supabase,
        firmId: firmId!,
        billingMonth: r.billing_month,
        clientName: r.client_name,
        generatedByEmail: GENERATED_BY,
        override,
      });
    } catch (err) {
      result = { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }

    await supabase
      .from('dtr_revision_reviews')
      .update({
        invoice_gen_status: result.ok ? ('skipped' in result && result.skipped ? 'skipped' : 'success') : 'failed',
        invoice_gen_error: result.ok ? null : (result.error ?? 'Invoice generation failed'),
        invoice_gen_invoice_id: ('invoiceId' in result ? result.invoiceId : null) ?? null,
        invoice_gen_invoice_number: ('invoiceNumber' in result ? result.invoiceNumber : null) ?? null,
        invoice_gen_at: new Date().toISOString(),
      })
      .eq('id', r.id);

    const label = result.ok
      ? 'skipped' in result && result.skipped
        ? 'SKIPPED (nothing billable)'
        : `OK ${'invoiceNumber' in result ? result.invoiceNumber : ''}`
      : `FAILED ${result.error}`;
    console.log(`  ${r.billing_month}  ${r.client_name}  →  ${label}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
