/**
 * Pure projection of a client's running-balance statement. Merges the opening
 * (brought-forward) balance, outstanding invoices, and the deposit/payment
 * ledger into dated lines with a running balance.
 *
 * The opening line is a PLUG: opening = currentBalance − Σ(other lines). This
 * guarantees the statement foots to the same running balance the receivables
 * page and invoice "previous balance" use, for every client — including the
 * deposit-history clients whose stored receivables can't be cleanly decomposed.
 * No backfill, no source-of-truth column: the balance stays authoritative and
 * the statement is a faithful breakdown of it.
 */

import { isAfterAnchor } from './client-balance';

export type StatementLineKind = 'opening' | 'invoice' | 'payment' | 'deposit' | 'refund' | 'adjustment';

export interface StatementInvoice {
  invoiceNumber: string;
  billingMonth: string; // 'YYYY-MM'
  balance: number; // open balance: total_due − paid
  sentDate: string | null;
  createdDate: string | null;
}

export interface StatementDeposit {
  type: string; // deposit | refund | adjustment | payment  (NOT 'application')
  amount: number; // signed ledger amount: + reduces the receivable, − increases it
  date: string; // 'YYYY-MM-DD'
  notes: string;
}

export interface StatementInputs {
  /** The running balance the statement must foot to (from client-balance). */
  currentBalance: number;
  /** clients.receivables — null when there is no opening anchor. */
  receivables: number | null;
  /** clients.receivables_as_of — 'YYYY-MM-DD' or null. */
  receivablesAsOf: string | null;
  invoices: StatementInvoice[];
  deposits: StatementDeposit[];
}

export interface StatementLine {
  key: string;
  date: string; // 'YYYY-MM-DD' (empty allowed for an undated opening)
  kind: StatementLineKind;
  label: string;
  charge: number; // increases what the client owes
  credit: number; // decreases what the client owes
  runningBalance: number;
}

export interface ClientStatement {
  lines: StatementLine[];
  currentBalance: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function monthLabel(billingMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(billingMonth);
  if (!m) return billingMonth;
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const idx = parseInt(m[2], 10) - 1;
  return idx >= 0 && idx < 12 ? `${months[idx]} ${m[1]}` : billingMonth;
}

/**
 * An invoice is a NEW charge (shown as its own line) when it falls after the
 * opening anchor; earlier invoices are assumed folded into the opening. Mirrors
 * lib/finance/client-balance so the statement and the running balance agree.
 */
function invoiceShown(inv: StatementInvoice, receivables: number | null, asOf: string | null): boolean {
  // No anchor → every invoice stands on its own. Otherwise reuse the SAME
  // after-anchor rule the running balance uses, so the statement can't desync.
  if (receivables === null || !asOf) return true;
  return isAfterAnchor(inv, asOf, asOf.slice(0, 7));
}

function depositLabel(d: StatementDeposit): string {
  const base = d.type === 'payment' ? 'Payment received'
    : d.type === 'refund' ? 'Refund'
    : d.type === 'adjustment' ? 'Adjustment'
    : 'Advance deposit';
  return d.notes ? `${base} — ${d.notes}` : base;
}

/**
 * Replay signed ledger entries on top of an opening balance to derive a running
 * balance per entry. Shared by the firm-wide ledger (entries decomposed as
 * billing/payment/deposit) so its per-client running balance is computed the
 * same way the statement foots — opening + cumulative signed amount. The sign
 * convention matches `clients.receivables`: + increases what the client owes.
 *
 * Returns a Map keyed by entry id → running balance after that entry, computed
 * over the chronological (oldest-first) order regardless of the input order.
 */
export function attachRunningBalance<T extends { id: string; date: string; amount: number }>(
  entries: T[],
  opening: number,
): Map<string, number> {
  const oldestFirst = [...entries].sort(
    (a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id),
  );
  const out = new Map<string, number>();
  let running = round2(opening);
  for (const e of oldestFirst) {
    running = round2(running + e.amount);
    out.set(e.id, running);
  }
  return out;
}

export function buildClientStatement(inp: StatementInputs): ClientStatement {
  const body: Omit<StatementLine, 'runningBalance'>[] = [];

  for (const inv of inp.invoices) {
    if (!invoiceShown(inv, inp.receivables, inp.receivablesAsOf)) continue;
    if (Math.abs(inv.balance) < 0.005) continue;
    body.push({
      key: `inv-${inv.invoiceNumber}`,
      date: inv.sentDate ?? `${inv.billingMonth}-01`,
      kind: 'invoice',
      label: `Invoice ${inv.invoiceNumber}${inv.billingMonth ? ` (${monthLabel(inv.billingMonth)})` : ''}`,
      charge: round2(inv.balance > 0 ? inv.balance : 0),
      credit: round2(inv.balance < 0 ? -inv.balance : 0),
    });
  }

  for (let i = 0; i < inp.deposits.length; i++) {
    const d = inp.deposits[i];
    // Only on-account 'payment' rows move amount due. A 'deposit'/'refund'/
    // 'adjustment' is a trust movement (deposit on hand), and an 'application'
    // is already reflected in its invoice's open balance — none of them belong
    // in the amount-due running balance.
    if (d.type !== 'payment' || Math.abs(d.amount) < 0.005) continue;
    body.push({
      key: `dep-${i}-${d.date}`,
      date: d.date,
      kind: 'payment',
      label: depositLabel(d),
      charge: round2(d.amount < 0 ? -d.amount : 0),
      credit: round2(d.amount > 0 ? d.amount : 0),
    });
  }

  // Chronological; the opening is prepended (always first) so the brought-forward
  // line leads regardless of how its as-of date compares to same-month invoices.
  body.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));

  const bodyNet = body.reduce((s, l) => s + l.charge - l.credit, 0);
  const opening = round2(inp.currentBalance - bodyNet);

  const lines: StatementLine[] = [];
  let running = 0;
  if (Math.abs(opening) >= 0.005) {
    running = opening;
    lines.push({
      key: 'opening',
      date: inp.receivablesAsOf ?? '',
      kind: 'opening',
      label: 'Balance brought forward',
      charge: opening > 0 ? opening : 0,
      credit: opening < 0 ? -opening : 0,
      runningBalance: round2(running),
    });
  }
  for (const l of body) {
    running += l.charge - l.credit;
    lines.push({ ...l, runningBalance: round2(running) });
  }

  return { lines, currentBalance: round2(inp.currentBalance) };
}
