/**
 * Canonical "generate a bundle's invoice from scratch" pipeline, shared by the
 * MP-approval auto-generation (dtr-review/decision) and the finance-triggered
 * Generate/Regenerate button (dtr-review/generate). Keeping it in one place
 * means a Review-generated invoice is identical to an approval-generated one.
 *
 * Resolves settings purely from the matter billing config + firm defaults +
 * live receivables, then layers the per-bundle override (with type coercion),
 * then persists. Pass `existingInvoice` to regenerate in place (reuse number,
 * bump revision, reverse old flags) instead of creating a new one.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchBillingData } from '@/lib/billing/fetch-billing-data';
import {
  persistInvoice,
  resolveInvoiceClientId,
  setInvoiceBilledFlags,
  type InvoiceSettingsSnapshot,
  type FeeLinePayload,
  type PersistInvoiceParams,
} from '@/lib/billing/persist-invoice';
import { findSignerAtty, getFirmInvoiceSettings } from '@/lib/billing/firm-defaults';
import { parseAdHocFeeLines } from '@/lib/billing/derive-fee-lines';
import { formatBalanceLabel } from '@/lib/billing/letter-format';
import { unresolvedBundleLawyers } from '@/lib/billing/bundle-lawyers';
import { UnresolvedLawyerError } from '@/lib/billing/lawyer-positions';
import { applyLetterOverride, isLetterOverrideKey, type ClientBillingProfile } from '@/lib/billing/client-profile';

export interface GenerateBundleResult {
  ok: boolean;
  invoiceId?: number;
  invoiceNumber?: string;
  error?: string;
  skipped?: boolean;
}

// Override values arrive as strings (text inputs) in the invoice_settings_override
// jsonb. The settings snapshot expects numbers / booleans for these keys, so
// coerce them; everything else stays a string.
const NUMERIC_OVERRIDE_KEYS = new Set(['retainerCap', 'retainerHoursCap', 'monthlyRetainer', 'previousBalance']);
const BOOLEAN_OVERRIDE_KEYS = new Set(['includeVAT', 'includeLessenFeesNote', 'settleFromDeposit']);

/**
 * The parts of an invoice's settings that come from who is billed and who
 * bills. The letter and its recipient — addressee, VAT, the paragraphs, the
 * early-payment discount — come from the client's billing profile; bank and
 * firm details from the matter's config over the firm defaults.
 */
export async function letterSettingsFromConfig(
  firmId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cfg: any,
  clientName: string,
  profile: ClientBillingProfile,
): Promise<InvoiceSettingsSnapshot> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matterSaved = (cfg?.billing_settings ?? {}) as Record<string, any>;
  const [firm, signerAtty] = await Promise.all([getFirmInvoiceSettings(firmId), findSignerAtty(firmId)]);
  return {
    letterAddressee: profile.letterAddressee,
    clientAddress: profile.clientAddress,
    attnName: profile.attnName ?? clientName,
    attnTitle: profile.attnTitle,
    throughName: profile.throughName,
    salutation: profile.salutation,
    clientEmail: profile.clientEmail,
    ccEmails: profile.ccEmails,
    includeVAT: profile.includeVAT ?? false,
    includeLessenFeesNote: profile.includeLessenFeesNote ?? false,
    initialStatement: profile.initialStatement ?? false,
    optionalParagraphs: profile.optionalParagraphs ?? [],
    earlyPaymentDiscountPercent: profile.earlyPaymentDiscountPercent,
    earlyPaymentDays: profile.earlyPaymentDays,
    bankName: matterSaved.bankName || firm.bankName,
    bankAccountNo: matterSaved.bankAccountNo || firm.bankAccountNo,
    bankAccountName: matterSaved.bankAccountName || firm.bankAccountName,
    // The Managing Partner signs (lib/billing/signer.ts); this is the firm's
    // fallback when the roster has no single one.
    signerName: firm.signerName,
    signerAtty,
    firmAddress: matterSaved.firmAddress || firm.firmAddress,
    firmAddress2: matterSaved.firmAddress2 || firm.firmAddress2,
    firmTIN: matterSaved.firmTIN || firm.firmTIN,
    engagementDate: cfg?.engagement_date ?? matterSaved.engagementDate,
  };
}

/**
 * Resolve the invoice settings snapshot + ad-hoc fee lines for a bundle, from
 * matter config + firm defaults + live receivables, then the per-bundle override.
 * Shared by the persist pipeline (generateBundleInvoice) and the read-only draft
 * breakdown preview, so both see identical settings.
 */
export async function resolveBundleSettings(args: {
  firmId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Awaited<ReturnType<typeof fetchBillingData>>;
  clientName: string;
  override?: Record<string, unknown> | null;
}): Promise<{ settings: InvoiceSettingsSnapshot; adHocFeeLines: FeeLinePayload[] }> {
  const { firmId, data, clientName, override } = args;

  const adHocFeeLines = parseAdHocFeeLines(override) as FeeLinePayload[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = data.billingConfig as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matterSaved = (cfg?.billing_settings ?? {}) as Record<string, any>;

  const settings: InvoiceSettingsSnapshot = {
    ...(await letterSettingsFromConfig(firmId, cfg, clientName, data.clientProfile)),
    // ON by default: bills settle against any advance deposit unless the
    // matter config explicitly opts out (deposits earmarked for filing fees etc.).
    settleFromDeposit: matterSaved.settleFromDeposit == null
      ? true
      : matterSaved.settleFromDeposit === 'true' || matterSaved.settleFromDeposit === true,
    retainerCap: data.monthlyRetainer > 0 ? data.monthlyRetainer : undefined,
    retainerHoursCap: data.retainerHoursCap != null ? data.retainerHoursCap : undefined,
    monthlyRetainer: data.monthlyRetainer > 0 ? data.monthlyRetainer : undefined,
    previousBalance: data.clientReceivables ?? undefined,
    previousBalanceLabel: data.clientReceivables != null
      ? formatBalanceLabel(data.clientReceivablesUpdatedAt, data.clientReceivables)
      : undefined,
    depositOnHand: data.clientDepositOnHand > 0 ? data.clientDepositOnHand : undefined,
    hourlyDiscountPercent: typeof matterSaved.hourlyDiscountPercent === 'string' ? matterSaved.hourlyDiscountPercent : undefined,
    totalDiscountPercent: typeof matterSaved.totalDiscountPercent === 'string' ? matterSaved.totalDiscountPercent : undefined,
  };

  // Layer the per-bundle override on top, coercing numeric/boolean keys. Only
  // keys present in the override replace defaults; blanks leave the default.
  let overrodePreviousBalance = false;
  let overrodePreviousBalanceLabel = false;
  if (override && typeof override === 'object') {
    for (const [k, v] of Object.entries(override)) {
      if (k === 'adHocItems' || isLetterOverrideKey(k)) continue;
      if (v === null || v === undefined || v === '') continue;
      let val: unknown = v;
      if (NUMERIC_OVERRIDE_KEYS.has(k)) {
        const n = Number(v);
        if (Number.isNaN(n)) continue;
        val = n;
      } else if (BOOLEAN_OVERRIDE_KEYS.has(k)) {
        val = v === true || v === 'true';
      }
      if (k === 'previousBalance') overrodePreviousBalance = true;
      if (k === 'previousBalanceLabel') overrodePreviousBalanceLabel = true;
      (settings as Record<string, unknown>)[k] = val;
    }
  }
  Object.assign(settings, applyLetterOverride(data.clientProfile, override));
  if (overrodePreviousBalance && !overrodePreviousBalanceLabel && typeof settings.previousBalance === 'number') {
    settings.previousBalanceLabel = formatBalanceLabel(data.clientReceivablesUpdatedAt, settings.previousBalance);
  }

  return { settings, adHocFeeLines };
}

export async function generateBundleInvoice(args: {
  supabase: SupabaseClient;
  firmId: string;
  billingMonth: string;
  clientName: string;
  generatedByEmail: string;
  override?: Record<string, unknown> | null;
  existingInvoice?: PersistInvoiceParams['existingInvoice'];
}): Promise<GenerateBundleResult> {
  const { supabase, firmId, billingMonth, clientName, generatedByEmail, override, existingInvoice } = args;
  try {
    // One monthly invoice per client+month. If the caller didn't pass an existing
    // invoice, detect it so we REGENERATE in place (reuse number, bump revision)
    // instead of inserting a duplicate — every generation surface dedups this way.
    let existing = existingInvoice;
    if (existing === undefined) {
      const { data: found } = await supabase
        .from('invoices')
        .select('id, invoice_number, status, line_items, expense_items, fee_lines, sent_date, previously_sent_at, revision_count')
        .eq('client_name', clientName)
        .eq('billing_month', billingMonth)
        .eq('invoice_kind', 'monthly')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (found) {
        existing = {
          id: found.id,
          invoice_number: found.invoice_number,
          line_items: found.line_items ?? [],
          expense_items: found.expense_items ?? [],
          fee_lines: found.fee_lines ?? [],
          sent_date: found.sent_date ?? null,
          previously_sent_at: found.previously_sent_at ?? null,
          revision_count: found.revision_count ?? 0,
        };
      }
    }

    // Regenerating reverts the existing invoice to a fresh draft, so free ALL of
    // its previously-billed items BEFORE fetchBillingData — DTRs, reimbursements,
    // matter expenses, action entries, milestones, and acceptance fees alike.
    // Five of those six are skipped by the fresh fetch while still flagged, and
    // would be silently dropped from the regenerated invoice: reimbursements and
    // matter expenses filter on `billed` in fetchBillingData; action entries,
    // milestones and acceptance fees on `invoiced` / `acceptance_fee_paid` in
    // deriveFeeLines. (This zeroed per-action invoices and dropped expenses from
    // drafts that had been sent before.)
    //
    // DTRs are the exception: getDTRBundleEntries reads every entry in the
    // bundle whatever its `billed` state, so clearing them here is what keeps
    // the flag honest, not what keeps them on the invoice. What stops a re-bill
    // is structural — a DTR belongs to exactly one (client, month) bundle and
    // only bundle invoices bill DTRs, so the invoice being regenerated is the
    // only one that could have flagged it. That holds as long as one invoice
    // per client+month does; nothing in the schema enforces it, and the lookup
    // above takes the newest of however many it finds.
    //
    // setInvoiceBilledFlags owns the billed-on-send invariant for every item
    // type, so reuse it rather than clear a partial subset. Runs for every
    // regenerate: a clean draft's flags are already false, so it's a harmless
    // no-op there.
    // A name on billable time that matches no team member has no position and
    // so no rate. Refuse before the regenerate below reverses any flags, so the
    // existing invoice is left exactly as it was.
    const unresolved = await unresolvedBundleLawyers(firmId, clientName, billingMonth);
    if (unresolved.length > 0) {
      return { ok: false, error: new UnresolvedLawyerError(unresolved).message };
    }
    // Same for a bundle whose matters name two different clients (throws).
    await resolveInvoiceClientId(supabase, clientName);

    if (existing) {
      await setInvoiceBilledFlags(supabase, existing, false);
    }

    const data = await fetchBillingData(supabase, firmId, clientName, billingMonth);

    // Ad-hoc items from the per-bundle override become their own fee lines, so
    // any billing type can carry one-off charges on a single invoice.
    const { settings, adHocFeeLines } = await resolveBundleSettings({ firmId, data, clientName, override });

    // Nothing to bill → skip cleanly. The MP approval still stands; finance can
    // log a fee/expense later and generate manually.
    if (data.lineItems.length === 0 && data.expenses.length === 0 && data.feeLines.length === 0 && adHocFeeLines.length === 0) {
      return { ok: true, skipped: true };
    }

    const result = await persistInvoice(supabase, {
      firmId,
      clientName,
      month: billingMonth,
      matterId: null,
      matterName: null,
      lineItems: data.lineItems,
      expenses: data.expenses,
      feeLines: [...(data.feeLines as FeeLinePayload[]), ...adHocFeeLines],
      settings,
      generatedByEmail,
      existingInvoice: existing,
    });

    return {
      ok: true,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoice_number,
    };
  } catch (err) {
    console.error('[generate-bundle-invoice] failed:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invoice generation failed',
    };
  }
}
