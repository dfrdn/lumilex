import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { BILLED_STATUSES } from '@/lib/finance/profitability';
import { invoiceGrossDue, type InvoiceAmountRow } from '@/lib/finance/invoice-amounts';

const ALLOWED = ['admin', 'super_user', 'finance'];

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BilledLine {
  id: number;
  invoiceNumber: string;
  clientName: string;
  matterName: string | null;
  status: string;
  billed: number; // gross amount due (incl. VAT) — the collection denominator
  paid: number; // amount collected against this invoice to date
  outstanding: number; // billed − paid
  collectionRate: number; // 0–100
  breakdownPdfPath: string | null;
}

export interface CashFlowDetail {
  period: string;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  collectionRate: number; // 0–100, weighted by amount
  invoices: BilledLine[];
}

const rate = (paid: number, billed: number) => (billed > 0 ? round2((paid / billed) * 100) : 0);

/**
 * GET /api/finance/cash-flow/detail?period=YYYY-MM  (or ?period=YYYY)
 * Collection rate for a period: every invoice billed in it, with how much the
 * client has since paid against it. "Billed" is the gross amount due (VAT-inclusive,
 * per lib/finance/invoice-amounts) so the rate is a true 0–100% — the same basis
 * Receivables uses. Finance-gated to match the invoices table RLS.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'lawyer';
  if (!ALLOWED.includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const period = req.nextUrl.searchParams.get('period') ?? '';
  const isMonth = /^\d{4}-\d{2}$/.test(period);
  const isYear = /^\d{4}$/.test(period);
  if (!isMonth && !isYear) {
    return NextResponse.json({ error: 'period must be YYYY-MM or YYYY' }, { status: 400 });
  }

  const monthFrom = isMonth ? period : `${period}-01`;
  const monthTo = isMonth ? period : `${period}-12`;

  const supabase = await getSupabaseServerAuthClient();

  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, client_name, matter_name, status, total_amount, total_expenses, paid_amount, billing_settings, breakdown_pdf_storage_path')
    .in('status', BILLED_STATUSES as unknown as string[])
    .gte('billing_month', monthFrom)
    .lte('billing_month', monthTo);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const invoices: BilledLine[] = (data ?? []).map((r) => {
    const billed = invoiceGrossDue(r as InvoiceAmountRow);
    const paid = round2(Number(r.paid_amount ?? 0));
    return {
      id: r.id as number,
      invoiceNumber: (r.invoice_number as string) ?? '—',
      clientName: (r.client_name as string) ?? '—',
      matterName: (r.matter_name as string) ?? null,
      status: (r.status as string) ?? '',
      billed,
      paid,
      outstanding: round2(billed - paid),
      collectionRate: rate(paid, billed),
      breakdownPdfPath: (r.breakdown_pdf_storage_path as string) ?? null,
    };
  });
  invoices.sort((a, b) => b.billed - a.billed);

  const totalBilled = round2(invoices.reduce((s, r) => s + r.billed, 0));
  const totalPaid = round2(invoices.reduce((s, r) => s + r.paid, 0));

  const detail: CashFlowDetail = {
    period,
    totalBilled,
    totalPaid,
    totalOutstanding: round2(totalBilled - totalPaid),
    collectionRate: rate(totalPaid, totalBilled),
    invoices,
  };

  return NextResponse.json(detail);
}
