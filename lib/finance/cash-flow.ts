/**
 * Pure firm cash-flow aggregation. Folds the income sources (billed invoices,
 * collected payments + deposits) and the money-out sources (firm operating
 * expenses) into one monthly series.
 *
 * Two income bases coexist (the UI toggles between them):
 *   • billed (accrual)    — invoices.total_amount + total_expenses by billing_month
 *   • collected (cash)     — invoice_payments (excluding deposit applications and
 *                            post-send credits) + client_deposits inflows
 *                            (deposit/payment) − refunds
 *
 * Sign discipline: an applied deposit appears BOTH as an invoice_payments row
 * (method 'deposit') and a client_deposits 'application' row. Both are excluded
 * from cash-in — the cash already landed when the deposit was first received.
 * A post-send discount is an invoice_payments row (method 'credit') that settles
 * part of the receivable WITHOUT cash changing hands — also excluded.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CashFlowInputs {
  /** invoices: amount already folded to total_amount + total_expenses. */
  billedInvoices: { billingMonth: string; amount: number }[];
  /** invoice_payments. method 'deposit' rows are deposit applications (not new cash). */
  payments: { date: string; amount: number; method: string }[];
  /** client_deposits of every type. */
  deposits: { date: string; type: string; amount: number }[];
  /** firm_expenses (operating money-out). */
  firmExpenses: { date: string; category: string; amount: number }[];
}

export interface MonthlyCashFlow {
  month: string; // YYYY-MM
  incomeBilled: number;
  incomeCollected: number;
  expenses: number; // total money out
  expenseByCategory: Record<string, number>;
  netBilled: number;
  netCollected: number;
}

/** Bonuses surface as this synthetic expense category in the breakdown. */
// A firm that pays bonuses records them as a firm_expenses row; this names the
// category the cash-flow dashboard colours distinctly when it sees one.
export const BONUS_CATEGORY = 'Bonuses';

const monthOf = (d: string) => (d ?? '').slice(0, 7);

export function computeMonthlyCashFlow(inp: CashFlowInputs): MonthlyCashFlow[] {
  const months = new Map<string, MonthlyCashFlow>();
  const get = (month: string): MonthlyCashFlow => {
    if (!/^\d{4}-\d{2}$/.test(month)) month = '0000-00';
    let m = months.get(month);
    if (!m) {
      m = { month, incomeBilled: 0, incomeCollected: 0, expenses: 0, expenseByCategory: {}, netBilled: 0, netCollected: 0 };
      months.set(month, m);
    }
    return m;
  };

  for (const inv of inp.billedInvoices) {
    get(monthOf(inv.billingMonth)).incomeBilled += Number(inv.amount) || 0;
  }

  for (const p of inp.payments) {
    if (p.method === 'deposit') continue; // deposit application — not new cash
    if (p.method === 'credit') continue; // post-send discount/credit — not cash
    get(monthOf(p.date)).incomeCollected += Number(p.amount) || 0;
  }

  for (const d of inp.deposits) {
    const amt = Number(d.amount) || 0;
    if (d.type === 'deposit' || d.type === 'payment') {
      get(monthOf(d.date)).incomeCollected += amt;
    } else if (d.type === 'refund') {
      get(monthOf(d.date)).incomeCollected -= amt; // cash returned to client
    }
    // 'application' (internal transfer) and 'adjustment' (non-cash) excluded.
  }

  for (const e of inp.firmExpenses) {
    const m = get(monthOf(e.date));
    const amt = Number(e.amount) || 0;
    m.expenses += amt;
    const cat = e.category || 'Other';
    m.expenseByCategory[cat] = (m.expenseByCategory[cat] ?? 0) + amt;
  }

  const out = [...months.values()];
  for (const m of out) {
    m.incomeBilled = round2(m.incomeBilled);
    m.incomeCollected = round2(m.incomeCollected);
    m.expenses = round2(m.expenses);
    for (const k of Object.keys(m.expenseByCategory)) m.expenseByCategory[k] = round2(m.expenseByCategory[k]);
    m.netBilled = round2(m.incomeBilled - m.expenses);
    m.netCollected = round2(m.incomeCollected - m.expenses);
  }
  out.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}

export interface YearlyCashFlow {
  year: string;
  incomeBilled: number;
  incomeCollected: number;
  expenses: number;
  expenseByCategory: Record<string, number>;
  netBilled: number;
  netCollected: number;
}

/** Roll a monthly series up to per-year totals. */
export function rollupToYears(monthly: MonthlyCashFlow[]): YearlyCashFlow[] {
  const years = new Map<string, YearlyCashFlow>();
  for (const m of monthly) {
    const year = m.month.slice(0, 4);
    let y = years.get(year);
    if (!y) {
      y = { year, incomeBilled: 0, incomeCollected: 0, expenses: 0, expenseByCategory: {}, netBilled: 0, netCollected: 0 };
      years.set(year, y);
    }
    y.incomeBilled = round2(y.incomeBilled + m.incomeBilled);
    y.incomeCollected = round2(y.incomeCollected + m.incomeCollected);
    y.expenses = round2(y.expenses + m.expenses);
    for (const [cat, amt] of Object.entries(m.expenseByCategory)) {
      y.expenseByCategory[cat] = round2((y.expenseByCategory[cat] ?? 0) + amt);
    }
  }
  const out = [...years.values()];
  for (const y of out) {
    y.netBilled = round2(y.incomeBilled - y.expenses);
    y.netCollected = round2(y.incomeCollected - y.expenses);
  }
  out.sort((a, b) => a.year.localeCompare(b.year));
  return out;
}
