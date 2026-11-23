/**
 * Assemble the breakdown-PDF/XLSX params from raw billing data + resolved
 * settings, WITHOUT persisting anything. Used to render an on-demand DRAFT
 * breakdown for a bundle that hasn't been approved yet.
 *
 * ⚠️ This mirrors the inline breakdown assembly in lib/billing/persist-invoice.ts
 * (the `breakdownParams` block: hourly-discount, cap-aware within/beyond split,
 * total discount, expense/acceptance/fee-line mapping). Keep the two in step —
 * if persistInvoice changes how it builds `breakdownParams`, change it here too,
 * so the draft preview matches the invoice that approval will eventually generate.
 * persistInvoice stays the source of truth for the *persisted* invoice; this is a
 * read-only echo of the same math for preview.
 */

import { computeCapAwareFees } from '@/lib/billing/cap-split';
import { invoiceGrossDue } from '@/lib/finance/invoice-amounts';
import { computeDepositSettlement } from '@/lib/finance/deposit-settlement';
import type { InvoiceSettingsSnapshot, FeeLinePayload } from '@/lib/billing/persist-invoice';
import type { AcceptanceFee, BreakdownFeeLine } from '@/lib/billing/breakdown-types';
import type { BillingBreakdownPdfParams } from '@/lib/pdf/billing-breakdown';

function parsePct(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

export function buildBreakdownParams(args: {
  clientName: string;
  month: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lineItems: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expenses: any[];
  feeLines: FeeLinePayload[];
  settings: InvoiceSettingsSnapshot;
}): BillingBreakdownPdfParams {
  const { clientName, month, expenses, settings } = args;
  // Work on copies so callers' arrays (e.g. fetchBillingData output) are never
  // mutated by the discount rewrite below.
  const lineItems = args.lineItems.map((l) => ({
    ...l,
    entries: Array.isArray(l.entries) ? l.entries.map((e: unknown) => ({ ...(e as object) })) : l.entries,
  }));
  const feeLinesArr: FeeLinePayload[] = [...(args.feeLines ?? [])];

  // ── Hourly-rate discount, applied to the per-lawyer + per-entry rates so the
  // breakdown reflects the discounted rate the client is billed.
  const hourlyDiscountFactor = 1 - parsePct(settings.hourlyDiscountPercent) / 100;
  if (hourlyDiscountFactor < 1) {
    for (const l of lineItems) {
      if (typeof l.hourlyRate === 'number') {
        l.hourlyRate = Math.round(l.hourlyRate * hourlyDiscountFactor * 100) / 100;
      }
      if (Array.isArray(l.entries)) {
        for (const e of l.entries) {
          if (typeof e.hourlyRate === 'number') {
            e.hourlyRate = Math.round(e.hourlyRate * hourlyDiscountFactor * 100) / 100;
          }
        }
      }
      if (typeof l.amount === 'number') {
        l.amount = Math.round(l.amount * hourlyDiscountFactor * 100) / 100;
      }
    }
  }

  // ── Cap-aware fee roll-up (within/beyond the retainer hours cap).
  const retainerFromFeeLine = feeLinesArr
    .filter((f) => f.kind === 'retainer')
    .reduce((s, f) => s + (f.amount ?? 0), 0);
  const monthlyRetainerCharge = Number(settings.monthlyRetainer) > 0
    ? Number(settings.monthlyRetainer)
    : retainerFromFeeLine;
  const capFees = computeCapAwareFees(lineItems, settings.retainerHoursCap, monthlyRetainerCharge, feeLinesArr);
  const { within: withinRetainer, beyond: beyondRetainer } = capFees;

  // ── Total discount as a synthetic (negative) fee line, matching persistInvoice.
  // Waived expenses are shown but billed at ₱0 — excluded from the total.
  const totalExpenses = (expenses ?? []).reduce((s: number, e) => s + (e.waived ? 0 : (e.amount ?? 0)), 0);
  const subtotalGrand = capFees.legalFees + totalExpenses;
  const totalDiscountPct = parsePct(settings.totalDiscountPercent);
  const totalDiscountAmount = totalDiscountPct > 0
    ? Math.round(subtotalGrand * (totalDiscountPct / 100) * 100) / 100
    : 0;
  if (totalDiscountAmount > 0) {
    feeLinesArr.push({
      kind: 'discount',
      matterId: null,
      matterName: null,
      description: `Less: Discount (${totalDiscountPct}% off)`,
      amount: -totalDiscountAmount,
    });
  }

  const [year, mon] = month.split('-');
  const monthDisplay = new Date(parseInt(year), parseInt(mon) - 1).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });

  const xlsxExpenses = (expenses ?? []).map((e) => ({
    date: e.date,
    description: e.expense ?? e.description ?? e.category ?? '',
    amount: e.amount ?? 0,
    waived: e.waived ?? false,
    photocopyDetail: e.photocopyDetail ?? undefined,
  }));

  const acceptanceFromFeeLines: AcceptanceFee[] = feeLinesArr
    .filter((f) => f.kind === 'acceptance')
    .map((f) => ({ clientOrMatter: f.matterName ?? clientName, caseDescription: '', amount: f.amount }));
  const mergedAcceptanceFees = [...(settings.acceptanceFees ?? []), ...acceptanceFromFeeLines];

  // Settle-from-deposit preview — same figures persistInvoice freezes into the
  // snapshot: applied caps at the CURRENT bill's gross due (incl. VAT).
  const grossDue = invoiceGrossDue({
    total_amount: capFees.legalFees - totalDiscountAmount,
    total_expenses: totalExpenses,
    billing_settings: { includeVAT: settings.includeVAT ?? false },
  });
  const settlement = settings.settleFromDeposit
    ? computeDepositSettlement(grossDue, settings.depositOnHand ?? 0)
    : null;

  const renderableFeeLines: BreakdownFeeLine[] = feeLinesArr
    .filter((f): f is FeeLinePayload & { kind: BreakdownFeeLine['kind'] } =>
      f.kind === 'fixed_fee' || f.kind === 'action' ||
      f.kind === 'milestone' || f.kind === 'informational_hours' ||
      f.kind === 'discount' || f.kind === 'adhoc',
    )
    .map((f) => ({
      kind: f.kind,
      matterName: f.matterName,
      description: f.description,
      amount: f.amount,
      quantity: f.quantity,
    }));

  return {
    firmAddress: settings.firmAddress ?? '',
    firmAddress2: settings.firmAddress2 ?? '',
    firmTIN: settings.firmTIN ?? '',
    billingPeriod: monthDisplay,
    monthlyRetainer: settings.monthlyRetainer ?? 0,
    acceptanceFees: mergedAcceptanceFees,
    withinRetainer,
    beyondRetainer,
    expenses: xlsxExpenses,
    includeVAT: settings.includeVAT ?? false,
    previousBalance: settings.previousBalance,
    previousBalanceLabel: settings.previousBalanceLabel,
    depositApplied: settlement?.applied,
    depositRemaining: settlement?.remaining,
    feeLines: renderableFeeLines,
    clientName,
    retainerHoursCap: settings.retainerHoursCap ?? null,
  };
}
