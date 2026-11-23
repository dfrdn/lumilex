/**
 * Canonical "what the client owes" math for a single invoice — the ONE place
 * VAT is applied, shared by the billing letter, the breakdown, and every
 * AR / receivables / statement / ledger / payment surface so the amount billed
 * and the amount tracked can never diverge.
 *
 * VAT (12%) is added on top of (legal fees + out-of-pocket expenses) for
 * VAT-registered invoices — identical to the breakdown PDF's GRAND TOTAL and the
 * letter's "including VAT" total. Whether an invoice carries VAT is read from its
 * own `billing_settings.includeVAT` snapshot, so historical invoices keep the
 * treatment they were generated with.
 *
 * Deliberately NOT used by revenue/profitability: VAT is output tax owed to the
 * BIR (a pass-through liability), not firm income — folding it into revenue would
 * overstate margins. Revenue stays on the pre-VAT `total_amount`.
 */

export const VAT_RATE = 0.12;

export interface InvoiceAmountRow {
  total_amount: number | string | null;
  total_expenses: number | string | null;
  paid_amount?: number | string | null;
  // The stored JSONB snapshot; only includeVAT matters here. Typed loosely
  // (includeVAT?: unknown) so any caller's billing_settings shape — including a
  // bare Record<string, unknown> — is assignable without a cast.
  billing_settings?: { includeVAT?: unknown } | null;
}

function vatApplies(billingSettings: InvoiceAmountRow['billing_settings']): boolean {
  const v = billingSettings?.includeVAT;
  return v === true || v === 'true';
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Pre-VAT taxable base: legal fees + out-of-pocket expenses. */
export function invoiceNet(inv: InvoiceAmountRow): number {
  return round2(Number(inv.total_amount ?? 0) + Number(inv.total_expenses ?? 0));
}

/** VAT amount for this invoice (0 when the invoice isn't VAT-registered). */
export function invoiceVat(inv: InvoiceAmountRow): number {
  if (!vatApplies(inv.billing_settings)) return 0;
  return round2(invoiceNet(inv) * VAT_RATE);
}

/** Gross amount the client owes for this invoice: net + VAT. */
export function invoiceGrossDue(inv: InvoiceAmountRow): number {
  return round2(invoiceNet(inv) + invoiceVat(inv));
}

/** Still-open balance: gross due − amount already paid. */
export function invoiceOpenBalance(inv: InvoiceAmountRow): number {
  return round2(invoiceGrossDue(inv) - Number(inv.paid_amount ?? 0));
}
