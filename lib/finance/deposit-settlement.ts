/**
 * Deposit-settlement math for invoices generated with "settle from advance
 * deposit" enabled: how much of the client's deposit on hand this bill draws
 * down, what remains in trust after, and what (if anything) is still due.
 *
 * The applied amount is capped at the CURRENT bill's gross due (incl. VAT) —
 * never the carried previous balance, which belongs to earlier invoices and is
 * settled against those invoices directly. This mirrors what the auto-apply on
 * send actually records (an invoice_payments row on this invoice), so the
 * printed figures and the ledger can't disagree.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface DepositSettlement {
  /** Amount drawn from the deposit against this bill (≤ both inputs). */
  applied: number;
  /** Deposit left in trust after the application. */
  remaining: number;
}

/**
 * How a bill of `grossDue` settles against `depositOnHand`. Returns null when
 * there is nothing to apply (no deposit, or nothing due).
 */
export function computeDepositSettlement(
  grossDue: number,
  depositOnHand: number,
): DepositSettlement | null {
  const due = round2(Number(grossDue) || 0);
  const onHand = round2(Number(depositOnHand) || 0);
  if (due <= 0.005 || onHand <= 0.005) return null;
  const applied = Math.min(onHand, due);
  return { applied: round2(applied), remaining: round2(onHand - applied) };
}

/** The snapshot flag arrives as boolean from resolved settings or as a
 *  'true'/'false' string from the matter config / override JSONB. */
export function settleFromDepositEnabled(v: unknown): boolean {
  return v === true || v === 'true';
}

/**
 * Read the settlement figures frozen into an invoice's billing_settings
 * snapshot at generation time. Returns null unless the invoice was generated
 * with settleFromDeposit on and a positive applied amount.
 */
export function depositSettlementFromSnapshot(
  billingSettings: Record<string, unknown> | null | undefined,
): DepositSettlement | null {
  if (!billingSettings || !settleFromDepositEnabled(billingSettings.settleFromDeposit)) return null;
  const applied = round2(Number(billingSettings.depositApplied) || 0);
  if (applied <= 0.005) return null;
  return { applied, remaining: round2(Number(billingSettings.depositRemaining) || 0) };
}
