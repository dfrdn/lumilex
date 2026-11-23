/**
 * The early-payment discount: a percentage off the month's legal fees that the
 * client earns by paying the invoice by a date ahead of the due date.
 *
 * It is an offer, not a reduction. The invoice is billed and booked at its full
 * amount; the letter states the offer, and when the client pays the discounted
 * figure in time the difference is booked as a `credit` payment — a post-send
 * discount, which the general ledger posts to Sales Discounts and cash flow
 * leaves out. So revenue is billed in full and the discount shows as given,
 * exactly as a credit finance records by hand does.
 *
 * The base is the legal fees for this period only (after any hourly or total
 * discount), with their VAT when the bill carries VAT. Out-of-pocket expenses
 * are never discounted, and neither is a carried previous balance.
 *
 * The offer is frozen into the invoice's billing_settings at generation
 * (`earlyPayment`), like the deposit settlement, so the letter, the email and
 * the payment that later qualifies all read the same figures.
 */

import { addDays, isCalendarDay, type DayString } from '@/lib/dates';
import { VAT_RATE } from '@/lib/finance/invoice-amounts';

const roundMoney = (n: number) => Math.round(n * 100) / 100;

/** A percent as typed on a client or an invoice: blank, invalid or negative is none; capped at 100. */
function parseDiscountPct(v: string | undefined | null): number {
  if (!v) return 0;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

export interface EarlyPaymentOffer {
  /** Percent off the period's legal fees. */
  percent: number;
  /** What the client saves by paying in time — fees × percent, with their VAT. */
  amount: number;
  /** Last day a payment counts toward the discount (YYYY-MM-DD, Manila). */
  deadline: DayString;
}

/** The discount when one is offered and the snapshot is well formed, else null. */
export function readEarlyPaymentOffer(billingSettings: unknown): EarlyPaymentOffer | null {
  const raw = (billingSettings as { earlyPayment?: unknown } | null | undefined)?.earlyPayment;
  if (!raw || typeof raw !== 'object') return null;
  const { percent, amount, deadline } = raw as Record<string, unknown>;
  const p = Number(percent);
  const a = Number(amount);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(a) || a <= 0) return null;
  if (typeof deadline !== 'string' || !isCalendarDay(deadline)) return null;
  return { percent: p, amount: roundMoney(a), deadline };
}

/** Days to the discount deadline, from the matter's setting. Blank or invalid is none. */
export function parseEarlyPaymentDays(v: string | number | undefined | null): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The offer for a new invoice, or null when there is none to make: no percent
 * or days set, no fees to discount, or the bill is being settled from the
 * advance deposit (there is nothing for the client to pay early).
 *
 * The deadline is `days` after the letter's date and never later than its due
 * date — an "early" payment date past the due date would be no offer at all.
 */
export function computeEarlyPaymentOffer(input: {
  percent: string | undefined;
  days: string | number | undefined;
  legalFees: number;
  includeVAT: boolean;
  letterDate: DayString;
  dueDate: DayString;
  settledFromDeposit: boolean;
}): EarlyPaymentOffer | null {
  const percent = parseDiscountPct(input.percent);
  const days = parseEarlyPaymentDays(input.days);
  if (percent <= 0 || days <= 0 || input.legalFees <= 0 || input.settledFromDeposit) return null;
  const onFees = roundMoney(input.legalFees * (percent / 100));
  const amount = input.includeVAT ? roundMoney(onFees * (1 + VAT_RATE)) : onFees;
  if (amount <= 0) return null;
  const byDays = addDays(input.letterDate, days);
  return { percent, amount, deadline: byDays < input.dueDate ? byDays : input.dueDate };
}

/** A payment row, as far as the discount cares. */
export interface EarlyPaymentRow {
  amount: number | string | null;
  payment_date: string | null;
  payment_method: string | null;
  reference_number: string | null;
}

/** Reference on the credit row that books an invoice's early-payment discount. */
export function earlyPaymentCreditRef(invoiceId: number): string {
  return `EPD-${invoiceId}`;
}

/**
 * Whether the invoice's payments have earned the discount: everything paid on
 * or before the deadline, other credits included, reaches the invoice's gross
 * due less the discount. The discount's own credit row never counts toward it.
 */
export function earnsEarlyPaymentDiscount(
  offer: EarlyPaymentOffer,
  grossDue: number,
  payments: EarlyPaymentRow[],
  creditRef: string,
): boolean {
  const inTime = payments
    .filter((p) => p.reference_number !== creditRef)
    .filter((p) => !!p.payment_date && p.payment_date.slice(0, 10) <= offer.deadline)
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);
  return roundMoney(inTime) >= roundMoney(grossDue - offer.amount) - 0.005;
}

/**
 * What the discount credit should be: the offer, but never more than the
 * invoice still has open without it — a client who paid in full anyway is not
 * credited past zero.
 */
export function earlyPaymentCreditAmount(
  offer: EarlyPaymentOffer,
  grossDue: number,
  payments: EarlyPaymentRow[],
  creditRef: string,
): number {
  const paid = payments
    .filter((p) => p.reference_number !== creditRef)
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const open = roundMoney(grossDue - paid);
  return open > 0.005 ? roundMoney(Math.min(offer.amount, open)) : 0;
}
