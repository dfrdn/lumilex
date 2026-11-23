import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { BILLED_STATUSES } from '@/lib/finance/profitability';
import { invoiceGrossDue, type InvoiceAmountRow } from '@/lib/finance/invoice-amounts';
import { nextMonthStart, manilaToday } from '@/lib/finance/format';

const ALLOWED = ['partner', 'admin', 'super_user', 'finance'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const rate = (paid: number, billed: number) => (billed > 0 ? round2((paid / billed) * 100) : 0);

/** Whole days between two YYYY-MM-DD dates (b − a). */
function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export type Timing = 'early' | 'on_time' | 'delayed';
/** Early ≤7d · on time ≤15d · delayed >15d, measured from billed → paid. */
function classify(days: number): Timing {
  if (days <= 7) return 'early';
  if (days <= 15) return 'on_time';
  return 'delayed';
}

/** Continuous YYYY-MM sequence from → to inclusive. */
function monthRange(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const start = fy * 12 + (fm - 1);
  const end = ty * 12 + (tm - 1);
  const out: string[] = [];
  for (let i = start; i <= end && out.length < 240; i++) {
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

export interface FinanceOverviewMonth {
  month: string;
  billed: number;
  collected: number;
  collectionRate: number | null; // null for months with nothing billed (line gaps, not a false 0%)
  opex: number;
}
export interface InvoiceDetail {
  id: number;
  invoiceNumber: string;
  clientName: string;
  matterName: string | null;
  month: string; // billing month YYYY-MM
  status: string;
  billed: number;
  paid: number;
  outstanding: number;
  collectionRate: number;
  billedDate: string | null; // baseline the timing is measured from
  paidDate: string | null; // last (or full) payment date
  fullyPaid: boolean;
  daysToPay: number | null; // billed → fully paid, when fullyPaid
  timing: Timing | null;
  daysSincePayment: number | null; // when not fully paid: days since last payment / since billed
  breakdownPdfPath: string | null;
}
export interface FinanceOverviewResponse {
  months: FinanceOverviewMonth[];
  totals: { billed: number; collected: number; collectionRate: number; opex: number; net: number };
  invoices: InvoiceDetail[];
}

/**
 * GET /api/partner/finance-overview?from=YYYY-MM&to=YYYY-MM&client=<name>
 * Partner-facing firm financial pulse: monthly collection rate (of invoices billed
 * that month) against firm operating expenses, plus a per-invoice breakdown with
 * payment-timing classification. Optional client filter narrows the collection side
 * only (opex is firm-wide). Service-role because partners are excluded from
 * invoices/firm_expenses by RLS — the role gate below is the guard.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'lawyer';
  if (!ALLOWED.includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const client = params.get('client');
  if (!from || !to || !/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM with from <= to' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  let invQ = supabase
    .from('invoices')
    .select('id, invoice_number, client_name, matter_name, status, billing_month, total_amount, total_expenses, paid_amount, billing_settings, sent_date, paid_date, created_at, breakdown_pdf_storage_path')
    .in('status', BILLED_STATUSES as unknown as string[])
    .gte('billing_month', from)
    .lte('billing_month', to);
  if (client) invQ = invQ.eq('client_name', client);

  const expQ = supabase
    .from('firm_expenses')
    .select('amount, expense_date')
    .gte('expense_date', `${from}-01`)
    .lt('expense_date', nextMonthStart(to));

  const [invRes, expRes] = await Promise.all([invQ, expQ]);
  for (const r of [invRes, expRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }
  const invRows = invRes.data ?? [];

  // Last *cash* payment date per invoice, for timing. Exclude method 'credit'
  // (a waiver/discount — no cash) and 'deposit' (a deposit application — the cash
  // arrived earlier); a late credit/adjustment row must not push the paid date out
  // and misclassify an on-time payment as delayed. Credit-only settlements fall
  // back to paid_date below.
  const ids = invRows.map((r) => r.id as number);
  const lastPayment = new Map<number, string>();
  if (ids.length) {
    const { data: pays, error } = await supabase
      .from('invoice_payments')
      .select('invoice_id, payment_date, payment_method')
      .in('invoice_id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of pays ?? []) {
      if (p.payment_method === 'credit' || p.payment_method === 'deposit') continue;
      const id = p.invoice_id as number;
      const d = p.payment_date as string;
      if (!d) continue;
      const prev = lastPayment.get(id);
      if (!prev || d > prev) lastPayment.set(id, d);
    }
  }

  const today = manilaToday();

  // Monthly aggregation.
  const seq = monthRange(from, to);
  const rows = new Map<string, FinanceOverviewMonth>(
    seq.map((m) => [m, { month: m, billed: 0, collected: 0, collectionRate: 0, opex: 0 }]),
  );
  for (const inv of invRows) {
    const row = rows.get((inv.billing_month as string)?.slice(0, 7));
    if (!row) continue;
    row.billed += invoiceGrossDue(inv as InvoiceAmountRow);
    row.collected += Number(inv.paid_amount ?? 0);
  }
  for (const e of expRes.data ?? []) {
    const row = rows.get((e.expense_date as string)?.slice(0, 7));
    if (row) row.opex += Number(e.amount ?? 0);
  }
  const months = seq.map((m) => {
    const row = rows.get(m)!;
    row.billed = round2(row.billed);
    row.collected = round2(row.collected);
    row.opex = round2(row.opex);
    row.collectionRate = row.billed > 0 ? rate(row.collected, row.billed) : null;
    return row;
  });

  // Per-invoice detail with payment timing.
  const invoices: InvoiceDetail[] = invRows.map((r) => {
    const billed = invoiceGrossDue(r as InvoiceAmountRow);
    const paid = round2(Number(r.paid_amount ?? 0));
    const fullyPaid = (r.status as string) === 'paid';
    const billedDate = (r.sent_date as string) ?? (r.created_at as string)?.slice(0, 10) ?? null;
    const paidDate = lastPayment.get(r.id as number) ?? (r.paid_date as string) ?? null;

    let daysToPay: number | null = null;
    let timing: Timing | null = null;
    let daysSincePayment: number | null = null;
    if (fullyPaid && billedDate && paidDate) {
      daysToPay = Math.max(0, dayDiff(billedDate, paidDate));
      timing = classify(daysToPay);
    } else {
      const ref = paidDate ?? billedDate;
      if (ref) daysSincePayment = Math.max(0, dayDiff(ref, today));
    }

    return {
      id: r.id as number,
      invoiceNumber: (r.invoice_number as string) ?? '—',
      clientName: (r.client_name as string) ?? '—',
      matterName: (r.matter_name as string) ?? null,
      month: (r.billing_month as string)?.slice(0, 7) ?? '',
      status: (r.status as string) ?? '',
      billed,
      paid,
      outstanding: round2(billed - paid),
      collectionRate: rate(paid, billed),
      billedDate,
      paidDate,
      fullyPaid,
      daysToPay,
      timing,
      daysSincePayment,
      breakdownPdfPath: (r.breakdown_pdf_storage_path as string) ?? null,
    };
  });
  // Unpaid first (largest outstanding), then paid (most recently paid first).
  invoices.sort((a, b) => {
    if (a.fullyPaid !== b.fullyPaid) return a.fullyPaid ? 1 : -1;
    if (!a.fullyPaid) return b.outstanding - a.outstanding;
    return (b.paidDate ?? '').localeCompare(a.paidDate ?? '');
  });

  const billed = round2(months.reduce((s, r) => s + r.billed, 0));
  const collected = round2(months.reduce((s, r) => s + r.collected, 0));
  const opex = round2(months.reduce((s, r) => s + r.opex, 0));

  const response: FinanceOverviewResponse = {
    months,
    totals: { billed, collected, collectionRate: rate(collected, billed), opex, net: round2(collected - opex) },
    invoices,
  };
  return NextResponse.json(response);
}
