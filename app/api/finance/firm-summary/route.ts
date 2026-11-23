import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { invoiceOpenBalance } from '@/lib/finance/invoice-amounts';

const ALLOWED_ROLES = ['partner', 'super_user', 'finance'];

/**
 * GET /api/finance/firm-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns a firm-level P&L snapshot for the window: revenue (billed + paid),
 * labor burden (sum of monthly_salary × months in window, all active team),
 * expenses, net, and outstanding AR.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');

  if (!from || !to) {
    return NextResponse.json(
      { error: 'Provide both from/to (YYYY-MM-DD)' },
      { status: 400 },
    );
  }

  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);

  // Months in window (inclusive), at least 1.
  const [fy, fm] = fromMonth.split('-').map((x) => parseInt(x, 10));
  const [ty, tm] = toMonth.split('-').map((x) => parseInt(x, 10));
  const monthsInWindow = Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);

  // ── Revenue ─────────────────────────────────────────────────
  const { data: invRows } = await supabase
    .from('invoices')
    .select('total_amount, total_expenses, paid_amount, status, billing_month, billing_settings')
    .gte('billing_month', fromMonth)
    .lte('billing_month', toMonth);

  // Revenue stays pre-VAT (VAT is output tax, not income); A/R outstanding is the
  // VAT-inclusive open balance — what the client actually still owes.
  let revenueBilled = 0;
  let revenuePaid = 0;
  let arOutstanding = 0;
  for (const r of invRows ?? []) {
    const amount = Number(r.total_amount ?? 0);
    if (r.status === 'paid') {
      revenuePaid += amount;
      revenueBilled += amount;
    } else if (r.status === 'sent') {
      revenueBilled += amount;
      arOutstanding += invoiceOpenBalance(r);
    }
  }

  // ── Labor burden (all active team, any role) ───────────────
  // Salary is read through the service role after the role check, ready for
  // monthly_salary to be withheld from user JWTs.
  const { data: teamRows } = await getServiceDbForFirm(session.firmId)
    .from('team')
    .select('monthly_salary')
    .eq('active', true);

  let monthlySalaryTotal = 0;
  let staffWithSalary = 0;
  let staffActive = 0;
  for (const t of teamRows ?? []) {
    staffActive += 1;
    if (t.monthly_salary != null) {
      monthlySalaryTotal += Number(t.monthly_salary);
      staffWithSalary += 1;
    }
  }
  const laborBurden = monthlySalaryTotal * monthsInWindow;

  // ── Matter expenses + reimbursements ───────────────────────
  const [{ data: mexps }, { data: reimbs }] = await Promise.all([
    supabase
      .from('matter_expenses')
      .select('amount')
      .gte('expense_date', from)
      .lte('expense_date', to),
    supabase
      .from('reimbursements')
      .select('amount')
      .gte('expense_date', from)
      .lte('expense_date', to),
  ]);

  const matterExpenses = (mexps ?? []).reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0,
  );
  const reimbursementsTotal = (reimbs ?? []).reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0,
  );
  const expensesTotal = matterExpenses + reimbursementsTotal;

  const netPaid = revenuePaid - laborBurden - expensesTotal;
  const netBilled = revenueBilled - laborBurden - expensesTotal;

  return NextResponse.json({
    window: { from, to, monthsInWindow },
    revenue: {
      billed: round2(revenueBilled),
      paid: round2(revenuePaid),
    },
    arOutstanding: round2(arOutstanding),
    laborBurden: round2(laborBurden),
    monthlySalaryTotal: round2(monthlySalaryTotal),
    staff: { active: staffActive, withSalary: staffWithSalary },
    expenses: {
      matter: round2(matterExpenses),
      reimbursements: round2(reimbursementsTotal),
      total: round2(expensesTotal),
    },
    net: { paid: round2(netPaid), billed: round2(netBilled) },
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
