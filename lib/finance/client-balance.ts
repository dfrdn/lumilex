import { lastDayOfMonth } from '@/lib/dates';
/**
 * Pure running-balance math for a single client, shared by the receivables page
 * and invoice generation so they can never diverge again.
 *
 * The identity (unchanged from what ReceivablesAging.tsx has always computed):
 *
 *   runningBalance = receivables + Σ(open invoice balances dated AFTER the
 *                    receivables_as_of anchor)
 *
 * `receivables` is the firm's brought-forward/opening figure (already net of any
 * deposit-ledger activity via trg_client_deposits_apply). Invoices issued after
 * the anchor are new charges that stack on top of it — mirroring the invoice
 * letter's "previous balance + current charges = total due".
 */

export interface BalanceInvoice {
  /** 'YYYY-MM' */
  billingMonth: string;
  /** Open balance: total_amount + total_expenses − paid_amount. */
  balance: number;
  /** 'YYYY-MM-DD' or null. */
  sentDate: string | null;
  /** 'YYYY-MM-DD' or null (created_at, date part). */
  createdDate: string | null;
}

export interface BalanceInputs {
  /** clients.receivables — null when finance never set an opening figure. */
  receivables: number | null;
  /** clients.receivables_as_of — 'YYYY-MM-DD' or null. */
  receivablesAsOf: string | null;
  /** The client's still-open invoices (balance > 0). */
  invoices: BalanceInvoice[];
}

/**
 * Is this invoice a NEW charge relative to the opening anchor? An invoice in a
 * later billing month is always new; one in the anchor's own month counts only
 * if it was issued after the anchor date (otherwise it's assumed folded into the
 * opening figure). Identical to the rule formerly inline in ReceivablesAging.
 */
export function isAfterAnchor(inv: BalanceInvoice, asOf: string, asOfMonth: string): boolean {
  const im = inv.billingMonth ?? '';
  if (im > asOfMonth) return true;
  if (im === asOfMonth) {
    const issued = inv.sentDate ?? inv.createdDate ?? '';
    return issued > asOf;
  }
  return false;
}

/**
 * The invoices that actually contribute to the running balance. `beforeMonth`
 * (e.g. '2026-05') restricts to invoices strictly before that billing month —
 * used when computing the "previous balance" for the invoice being generated, so
 * it never counts itself or later months. With no opening figure every in-scope
 * invoice contributes; with one, only those issued after the anchor do.
 *
 * Exposed so callers that need to describe the balance (e.g. the letter's
 * "as of" date) can read the same set the sum is built from.
 */
export function balanceInvoices(inp: BalanceInputs, beforeMonth?: string): BalanceInvoice[] {
  const { receivables, receivablesAsOf, invoices } = inp;
  const inScope = invoices.filter((i) => (beforeMonth ? (i.billingMonth ?? '') < beforeMonth : true));
  if (receivables === null) return inScope;
  if (!receivablesAsOf) return [];
  const asOfMonth = receivablesAsOf.slice(0, 7);
  return inScope.filter((i) => isAfterAnchor(i, receivablesAsOf, asOfMonth));
}

/**
 * Sum of open invoice balances that stack on top of the opening figure.
 */
export function carriedForward(inp: BalanceInputs, beforeMonth?: string): number {
  if (inp.receivables === null) return 0;
  return balanceInvoices(inp, beforeMonth).reduce((s, i) => s + i.balance, 0);
}

/**
 * The client's running balance: opening figure + carried-forward invoices.
 * When there is no opening figure, falls back to the plain sum of open invoice
 * balances (the page's `computedBalance`). Positive = client owes the firm,
 * negative = firm owes the client (advance deposit credit).
 */
export function runningBalance(inp: BalanceInputs, beforeMonth?: string): number {
  const sum = balanceInvoices(inp, beforeMonth).reduce((s, i) => s + i.balance, 0);
  return inp.receivables === null ? sum : inp.receivables + sum;
}

/** 'YYYY-MM' → last calendar day of that month as 'YYYY-MM-DD'. */
export function billingMonthEnd(month: string): string {
  return lastDayOfMonth(month);
}
