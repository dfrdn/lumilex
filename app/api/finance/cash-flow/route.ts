import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { BILLED_STATUSES } from '@/lib/finance/profitability';
import { computeMonthlyCashFlow, rollupToYears, type CashFlowInputs } from '@/lib/finance/cash-flow';
import { nextMonthStart } from '@/lib/finance/format';

const ALLOWED = ['admin', 'super_user', 'finance'];

/**
 * GET /api/finance/cash-flow?from=YYYY-MM&to=YYYY-MM
 * Monthly firm cash-flow series (income billed/collected vs money-out) plus a
 * yearly rollup. Gated to finance roles to match the
 * firm_expenses RLS (a non-finance JWT would read 0 expense rows).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'lawyer';
  if (!ALLOWED.includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const from = params.get('from'); // YYYY-MM (optional)
  const to = params.get('to');     // YYYY-MM (optional)
  const fromDate = from && /^\d{4}-\d{2}$/.test(from) ? `${from}-01` : null;
  // Exclusive upper bound: first day of the month AFTER `to` (avoids invalid 31sts).
  const toExclusive = to && /^\d{4}-\d{2}$/.test(to) ? nextMonthStart(to) : null;

  const supabase = await getSupabaseServerAuthClient();

  let invQ = supabase
    .from('invoices')
    .select('billing_month, total_amount, total_expenses, status')
    .in('status', BILLED_STATUSES as unknown as string[]);
  if (from) invQ = invQ.gte('billing_month', from);
  if (to) invQ = invQ.lte('billing_month', to);

  let payQ = supabase.from('invoice_payments').select('amount, payment_date, payment_method');
  if (fromDate) payQ = payQ.gte('payment_date', fromDate);
  if (toExclusive) payQ = payQ.lt('payment_date', toExclusive);

  let depQ = supabase.from('client_deposits').select('type, amount, transaction_date');
  if (fromDate) depQ = depQ.gte('transaction_date', fromDate);
  if (toExclusive) depQ = depQ.lt('transaction_date', toExclusive);

  let expQ = supabase.from('firm_expenses').select('amount, category, expense_date');
  if (fromDate) expQ = expQ.gte('expense_date', fromDate);
  if (toExclusive) expQ = expQ.lt('expense_date', toExclusive);

  const [invRes, payRes, depRes, expRes] = await Promise.all([invQ, payQ, depQ, expQ]);
  for (const r of [invRes, payRes, depRes, expRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  const inputs: CashFlowInputs = {
    billedInvoices: (invRes.data ?? []).map((r) => ({
      billingMonth: r.billing_month as string,
      amount: Number(r.total_amount ?? 0) + Number(r.total_expenses ?? 0),
    })),
    payments: (payRes.data ?? []).map((r) => ({
      date: r.payment_date as string,
      amount: Number(r.amount ?? 0),
      method: (r.payment_method as string) ?? '',
    })),
    deposits: (depRes.data ?? []).map((r) => ({
      date: r.transaction_date as string,
      type: r.type as string,
      amount: Number(r.amount ?? 0),
    })),
    firmExpenses: (expRes.data ?? []).map((r) => ({
      date: r.expense_date as string,
      category: (r.category as string) ?? 'Other',
      amount: Number(r.amount ?? 0),
    })),
  };

  const monthly = computeMonthlyCashFlow(inputs);
  const yearly = rollupToYears(monthly);

  return NextResponse.json({ monthly, yearly });
}
