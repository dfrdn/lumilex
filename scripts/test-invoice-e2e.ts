/**
 * End-to-end invoice-generation test.
 *
 * Replays the production "managing-partner approval → auto-generate draft
 * invoice" path (app/api/finance/dtr-review/decision/route.ts `autoGenerateInvoice`)
 * for every bundle in a month that is approved but whose invoice generation
 * previously FAILED. Exercises the full chain end to finish:
 *
 *   fetchBillingData  (unbilled DTRs + retainer/fixed/per-action/per-milestone
 *                       configs + reimbursements + matter_expenses + balance)
 *     → persistInvoice (allocate_invoice_number RPC → DOCX letter + XLSX +
 *                       breakdown PDF → storage upload → invoices row insert →
 *                       flag DTRs/expenses billed)
 *     → write invoice_gen_status back onto the review row (success/failed)
 *
 * Then downloads each invoice's artifacts to /tmp/invoice-e2e for inspection.
 *
 * Run: npx tsx scripts/test-invoice-e2e.ts [YYYY-MM]   (default 2026-05)
 *
 * Uses the service-role client (a script has no user JWT); RLS write policies
 * for finance/super_user would permit the same writes, so output is identical
 * to the route running as finance.
 */
import './load-env';
import * as fs from 'fs';
import * as path from 'path';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { fetchBillingData } from '@/lib/billing/fetch-billing-data';
import { persistInvoice, type InvoiceSettingsSnapshot, type FeeLinePayload } from '@/lib/billing/persist-invoice';
import { formatBalanceLabel } from '@/lib/billing/letter-format';
import { getFirmInvoiceSettings } from '@/lib/billing/firm-defaults';

const month = process.argv[2] ?? '2026-05';
// Optional: restrict to specific client names (argv[3..]). Empty = all failed.
const clientFilter = process.argv.slice(3);
const OUT_DIR = '/tmp/invoice-e2e';
const GENERATED_BY = 'e2e-test@lumilex.test';

const peso = (n: number) =>
  '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


async function resolveFirmId(requested: string | null): Promise<string> {
  const { data: firms } = await getSupabase()
    .from('firms')
    .select('id, slug, status')
    .eq('status', 'active')
    .order('slug');
  const list = (firms ?? []) as { id: string; slug: string }[];
  if (list.length === 0) throw new Error('No active firms.');

  if (requested) {
    const hit = list.find((f) => f.id === requested || f.slug === requested);
    if (!hit) {
      throw new Error(`No active firm matching "${requested}". Active: ${list.map((f) => f.slug).join(', ')}`);
    }
    return hit.id;
  }

  if (list.length > 1) {
    throw new Error(`Several active firms — pass --firm <slug>: ${list.map((f) => f.slug).join(', ')}`);
  }
  console.log(`Firm: ${list[0].slug} (${list[0].id})`);
  return list[0].id;
}

async function main() {
  const firmFlagIdx = process.argv.indexOf('--firm');
  const firmId = await resolveFirmId(firmFlagIdx !== -1 ? (process.argv[firmFlagIdx + 1] ?? null) : null);
  const supabase = getServiceDbForFirm(firmId);
  const firmDefaults = await getFirmInvoiceSettings(firmId);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`\n=== Invoice generation E2E — ${month} ===\n`);

  // Target the exact bundles that are approved but failed generation.
  const { data: reviews, error: revErr } = await supabase
    .from('dtr_revision_reviews')
    .select('client_name, status, invoice_gen_status, invoice_settings_override')
    .eq('billing_month', month)
    .eq('status', 'approved')
    .eq('invoice_gen_status', 'failed')
    .order('client_name');
  if (revErr) throw revErr;

  const targets = clientFilter.length
    ? (reviews ?? []).filter((r) => clientFilter.includes(r.client_name as string))
    : (reviews ?? []);

  if (targets.length === 0) {
    console.log('No matching approved+failed bundles for this month. Nothing to do.');
    return;
  }

  console.log(`Processing ${targets.length} approved-but-failed bundle(s):`);
  targets.forEach((r) => console.log(`  • ${r.client_name}`));
  console.log('');

  const results: Array<{
    client: string;
    ok: boolean;
    invoiceNumber?: string;
    fees?: number;
    expenses?: number;
    grand?: number;
    skipped?: boolean;
    error?: string;
    docx?: string | null;
    breakdownPdf?: string | null;
    letterPdf?: string | null;
  }> = [];

  for (const review of targets) {
    const clientName = review.client_name as string;
    process.stdout.write(`→ ${clientName} … `);

    // Guard: never mint a second client-level invoice for the month.
    const { data: existingInv } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('billing_month', month)
      .eq('client_name', clientName)
      .limit(1);
    if (existingInv && existingInv.length > 0) {
      console.log(`SKIP (already has ${existingInv[0].invoice_number})`);
      results.push({ client: clientName, ok: true, skipped: true, invoiceNumber: existingInv[0].invoice_number });
      continue;
    }

    try {
      const data = await fetchBillingData(supabase, firmId, clientName, month);

      if (data.lineItems.length === 0 && data.expenses.length === 0 && data.feeLines.length === 0) {
        console.log('SKIP (no billable entries)');
        await supabase
          .from('dtr_revision_reviews')
          .update({ invoice_gen_status: 'skipped', invoice_gen_error: null, invoice_gen_at: new Date().toISOString() })
          .eq('billing_month', month)
          .eq('client_name', clientName);
        results.push({ client: clientName, ok: true, skipped: true });
        continue;
      }

      // ── Settings: identical precedence to autoGenerateInvoice() in the
      //    decision route — matter config + billing_settings, then override.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg = data.billingConfig as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matterSaved = (cfg?.billing_settings ?? {}) as Record<string, any>;

      const settings: InvoiceSettingsSnapshot = {
        clientAddress: matterSaved.clientAddress,
        attnName: matterSaved.attnName ?? clientName,
        attnTitle: matterSaved.attnTitle,
        throughName: matterSaved.throughName,
        salutation: matterSaved.salutation,
        bankName: matterSaved.bankName || firmDefaults.bankName,
        bankAccountNo: matterSaved.bankAccountNo || firmDefaults.bankAccountNo,
        bankAccountName: matterSaved.bankAccountName || firmDefaults.bankAccountName,
        signerName: matterSaved.signerName || firmDefaults.signerName,
        firmAddress: matterSaved.firmAddress || firmDefaults.firmAddress,
        firmAddress2: matterSaved.firmAddress2 || firmDefaults.firmAddress2,
        firmTIN: matterSaved.firmTIN || firmDefaults.firmTIN,
        includeVAT: matterSaved.includeVAT === 'true' || matterSaved.includeVAT === true,
        includeLessenFeesNote: matterSaved.includeLessenFeesNote === 'true' || matterSaved.includeLessenFeesNote === true,
        engagementDate: cfg?.engagement_date ?? matterSaved.engagementDate,
        retainerCap: cfg?.monthly_retainer != null ? Number(cfg.monthly_retainer) : undefined,
        retainerHoursCap: cfg?.retainer_hours_cap != null ? Number(cfg.retainer_hours_cap) : undefined,
        monthlyRetainer: cfg?.monthly_retainer != null ? Number(cfg.monthly_retainer) : undefined,
        previousBalance: data.clientReceivables ?? undefined,
        previousBalanceLabel: data.clientReceivables != null
          ? formatBalanceLabel(data.clientReceivablesUpdatedAt, data.clientReceivables)
          : undefined,
        clientEmail: typeof matterSaved.clientEmail === 'string' ? matterSaved.clientEmail : undefined,
        ccEmails: typeof matterSaved.ccEmails === 'string' ? matterSaved.ccEmails : undefined,
        hourlyDiscountPercent: typeof matterSaved.hourlyDiscountPercent === 'string' ? matterSaved.hourlyDiscountPercent : undefined,
        totalDiscountPercent: typeof matterSaved.totalDiscountPercent === 'string' ? matterSaved.totalDiscountPercent : undefined,
      };

      const override = (review.invoice_settings_override ?? null) as Record<string, unknown> | null;
      if (override && typeof override === 'object') {
        for (const [k, v] of Object.entries(override)) {
          if (v === null || v === undefined || v === '') continue;
          (settings as Record<string, unknown>)[k] = v;
        }
      }

      const result = await persistInvoice(supabase, {
        firmId,
        clientName,
        month,
        matterId: null,
        matterName: null,
        lineItems: data.lineItems,
        expenses: data.expenses,
        feeLines: data.feeLines as FeeLinePayload[],
        settings,
        generatedByEmail: GENERATED_BY,
      });

      const fees = Number(result.invoice.total_amount ?? 0);
      const expenses = Number(result.invoice.total_expenses ?? 0);
      const invoiceNumber = result.invoice.invoice_number as string;

      // Mirror the route's success write-back onto the review row.
      await supabase
        .from('dtr_revision_reviews')
        .update({
          invoice_gen_status: 'success',
          invoice_gen_error: null,
          invoice_gen_invoice_id: result.invoice.id,
          invoice_gen_invoice_number: invoiceNumber,
          invoice_gen_at: new Date().toISOString(),
        })
        .eq('billing_month', month)
        .eq('client_name', clientName);

      // Download artifacts from storage for inspection.
      const safe = invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '_');
      const dl = async (storagePath: string | null | undefined, ext: string): Promise<string | null> => {
        if (!storagePath) return null;
        const { data: file, error } = await supabase.storage.from('files').download(storagePath);
        if (error || !file) return null;
        const buf = Buffer.from(await file.arrayBuffer());
        const out = path.join(OUT_DIR, `${safe}${ext}`);
        fs.writeFileSync(out, buf);
        return out;
      };
      const inv = result.invoice;
      const [docxOut, breakdownOut, letterPdfOut] = await Promise.all([
        dl(inv.docx_storage_path, '.docx'),
        dl(inv.breakdown_pdf_storage_path, '-breakdown.pdf'),
        dl(inv.pdf_storage_path, '-letter.pdf'),
      ]);

      console.log(`OK  ${invoiceNumber}  fees ${peso(fees)}  exp ${peso(expenses)}  total ${peso(fees + expenses)}`);
      results.push({
        client: clientName,
        ok: true,
        invoiceNumber,
        fees,
        expenses,
        grand: fees + expenses,
        docx: docxOut,
        breakdownPdf: breakdownOut,
        letterPdf: letterPdfOut,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`FAIL  ${message}`);
      results.push({ client: clientName, ok: false, error: message });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  const generated = results.filter((r) => r.ok && !r.skipped && r.invoiceNumber);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.ok);
  console.log(`generated: ${generated.length}   skipped: ${skipped.length}   failed: ${failed.length}`);
  if (generated.length) {
    console.log('\nGenerated invoices:');
    for (const g of generated) {
      console.log(`  ${g.invoiceNumber}  ${g.client}  →  ${peso(g.grand ?? 0)}`);
    }
  }
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  ${f.client}: ${f.error}`);
  }
  console.log(`\nArtifacts written to ${OUT_DIR}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
