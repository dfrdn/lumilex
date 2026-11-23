import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { attachRunningBalance } from '@/lib/finance/client-statement';
import { runningBalance, type BalanceInvoice } from '@/lib/finance/client-balance';
import { invoiceGrossDue, invoiceOpenBalance } from '@/lib/finance/invoice-amounts';

const BILLED = ['sent', 'partial', 'paid'];

/**
 * GET /api/finance/ledger
 * A unified, read-only feed of every financial entry across three sources:
 *   • billings  — `invoices`
 *   • payments  — `invoice_payments` (includes deposit-applied payments)
 *   • deposits  — `client_deposits` of type deposit / refund / adjustment
 *
 * `client_deposits` rows of type 'application' are intentionally skipped: an
 * applied deposit already shows up as an `invoice_payments` row (method
 * 'deposit'), so including it would double-count the same economic event.
 *
 * `amount` is the entry's impact on what the client owes the firm (the same
 * sign convention as `clients.receivables`): + increases the receivable,
 * − decreases it. So a billing is positive; a payment or a fresh deposit is
 * negative; a refund is positive.
 *
 * Query params (all optional): client, type (all|billing|payment|deposit),
 * month (YYYY-MM), search, limit.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'partner', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const clientFilter = params.get('client')?.trim() || null;
  const typeFilter = params.get('type') || 'all';
  const monthFilter = params.get('month'); // YYYY-MM
  const search = params.get('search')?.trim().toLowerCase() || null;
  const limit = Math.min(Number(params.get('limit') ?? 1000), 2000);

  const supabase = await getSupabaseServerAuthClient();

  // Bound each fetch (newest first) so we never silently hit PostgREST's default
  // 1000-row cap. If a source returns the full cap, the feed is truncated and we
  // tell the UI to surface a "refine filters" notice instead of showing wrong totals.
  const FETCH_CAP = 5000;
  const [invoicesRes, paymentsRes, depositsRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, client_name, billing_month, total_amount, total_expenses, paid_amount, status, sent_date, created_at, billing_settings')
      .order('created_at', { ascending: false })
      .limit(FETCH_CAP),
    supabase
      .from('invoice_payments')
      .select('id, invoice_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, created_at')
      .order('payment_date', { ascending: false })
      .limit(FETCH_CAP),
    supabase
      .from('client_deposits')
      .select('id, client_name, type, amount, transaction_date, payment_method, reference_number, notes, invoice_id, recorded_by, created_at')
      .neq('type', 'application')
      .order('transaction_date', { ascending: false })
      .limit(FETCH_CAP),
  ]);

  if (invoicesRes.error) return NextResponse.json({ error: invoicesRes.error.message }, { status: 500 });
  if (paymentsRes.error) return NextResponse.json({ error: paymentsRes.error.message }, { status: 500 });
  if (depositsRes.error) return NextResponse.json({ error: depositsRes.error.message }, { status: 500 });

  interface InvoiceRow {
    id: number; invoice_number: string; client_name: string; billing_month: string;
    total_amount: number; total_expenses: number; paid_amount: number; status: string;
    sent_date: string | null; created_at: string;
    billing_settings: { includeVAT?: boolean | string | null } | null;
  }
  const invoices = (invoicesRes.data ?? []) as InvoiceRow[];
  const invoiceById = new Map<number, InvoiceRow>();
  for (const inv of invoices) invoiceById.set(inv.id, inv);

  interface LedgerEntry {
    id: string;
    kind: 'billing' | 'payment' | 'deposit';
    subtype: string;
    date: string;
    clientName: string;
    description: string;
    reference: string | null;
    method: string | null;
    amount: number;
    // Impact on amount due. Equals `amount` for billings, payments and
    // on-account paydowns; 0 for trust movements (deposit/refund/adjustment),
    // which change deposit on hand, not what the client owes.
    balanceImpact: number;
    recordedBy: string | null;
    runningBalance?: number;
  }
  const entries: LedgerEntry[] = [];

  // ── Billings ──
  for (const inv of invoices) {
    // VAT-inclusive charge — the ledger entry must match what the client was
    // billed so the running balance foots against gross payments.
    const total = invoiceGrossDue(inv);
    entries.push({
      id: `billing-${inv.id}`,
      kind: 'billing',
      subtype: inv.status,
      date: inv.sent_date ?? inv.created_at?.split('T')[0] ?? inv.billing_month + '-01',
      clientName: inv.client_name,
      description: `Invoice ${inv.invoice_number} (${inv.billing_month})`,
      reference: inv.invoice_number,
      method: null,
      amount: total,
      balanceImpact: total,
      recordedBy: null,
    });
  }

  // ── Payments (incl. deposit-applied) ──
  for (const p of (paymentsRes.data ?? []) as Array<{
    id: number; invoice_id: number; amount: number; payment_date: string;
    payment_method: string; reference_number: string; notes: string; recorded_by: string; created_at: string;
  }>) {
    const inv = invoiceById.get(p.invoice_id);
    const isCredit = p.payment_method === 'credit';
    const noun = isCredit ? 'Credit' : 'Payment';
    entries.push({
      id: `payment-${p.id}`,
      kind: 'payment',
      subtype: p.payment_method === 'deposit' ? 'deposit applied' : isCredit ? 'discount/credit' : 'payment',
      date: p.payment_date ?? p.created_at?.split('T')[0],
      clientName: inv?.client_name ?? '—',
      description: inv
        ? `${noun} on ${inv.invoice_number}${p.notes ? ` — ${p.notes}` : ''}`
        : (p.notes || noun),
      reference: p.reference_number || inv?.invoice_number || null,
      method: p.payment_method || null,
      amount: -Number(p.amount ?? 0),
      balanceImpact: -Number(p.amount ?? 0),
      recordedBy: p.recorded_by || null,
    });
  }

  // ── Deposits / refunds / adjustments ──
  for (const d of (depositsRes.data ?? []) as Array<{
    id: number; client_name: string; type: string; amount: number; transaction_date: string;
    payment_method: string; reference_number: string; notes: string; invoice_id: number | null;
    recorded_by: string; created_at: string;
  }>) {
    entries.push({
      id: `deposit-${d.id}`,
      kind: 'deposit',
      subtype: d.type, // deposit | refund | adjustment
      date: d.transaction_date ?? d.created_at?.split('T')[0],
      clientName: d.client_name,
      description: d.notes || `${d.type.charAt(0).toUpperCase()}${d.type.slice(1)}`,
      reference: d.reference_number || null,
      method: d.payment_method || null,
      // Display the movement with the same sign convention as before, but only
      // on-account 'payment' rows reduce amount due. A deposit/refund/adjustment
      // moves deposit on hand, so it has zero impact on the running balance.
      amount: -Number(d.amount ?? 0),
      balanceImpact: d.type === 'payment' ? -Number(d.amount ?? 0) : 0,
      recordedBy: d.recorded_by || null,
    });
  }

  // A source hitting the fetch cap means older rows were dropped → the entry set
  // (and any running balance derived from it) is incomplete. The UI shows a notice.
  const truncated =
    (invoicesRes.data?.length ?? 0) >= FETCH_CAP ||
    (paymentsRes.data?.length ?? 0) >= FETCH_CAP ||
    (depositsRes.data?.length ?? 0) >= FETCH_CAP;

  // ── Per-client running balance ──
  // When scoped to a single client (and the feed isn't truncated), derive a
  // running balance per entry. `currentBalance` is computed via the SAME
  // runningBalance() helper the receivables page / statement use, so all three
  // surfaces foot to one figure. opening is the plug (currentBalance − Σ entry
  // amounts); we replay oldest→newest over the client's full entry set so each
  // row shows the true account balance as of that line.
  //
  // Draft invoices are EXCLUDED from the balance set: they carry no receivable
  // impact (currentBalance doesn't count them), so including their face value
  // would skew the opening plug and every preceding row. Draft rows therefore
  // show no running balance (undefined → '—' in the UI), which is correct.
  let openingBalance: number | null = null;
  let currentBalance: number | null = null;
  if (clientFilter && !truncated) {
    const { data: clientRow } = await supabase
      .from('clients')
      .select('receivables, receivables_as_of')
      .eq('name', clientFilter)
      .maybeSingle();
    const receivables = clientRow?.receivables == null ? null : Number(clientRow.receivables);
    const receivablesAsOf = clientRow?.receivables_as_of ?? null;
    const balanceInvoices: BalanceInvoice[] = invoices
      .filter((i) => i.client_name === clientFilter && BILLED.includes(i.status))
      .map((i) => ({
        billingMonth: i.billing_month,
        balance: invoiceOpenBalance(i),
        sentDate: i.sent_date,
        createdDate: i.created_at ? i.created_at.split('T')[0] : null,
      }))
      .filter((i) => i.balance > 0.005);
    currentBalance = runningBalance({ receivables, receivablesAsOf, invoices: balanceInvoices });

    const balanceEntries = entries.filter(
      (e) => e.clientName === clientFilter && !(e.kind === 'billing' && e.subtype === 'draft'),
    );
    const entriesNet = balanceEntries.reduce((s, e) => s + e.balanceImpact, 0);
    openingBalance = Math.round((currentBalance - entriesNet) * 100) / 100;
    // Replay over balanceImpact (amount due), not the display amount — trust
    // movements must not shift the running balance.
    const rbById = attachRunningBalance(
      balanceEntries.map((e) => ({ id: e.id, date: e.date, amount: e.balanceImpact })),
      openingBalance,
    );
    for (const e of balanceEntries) e.runningBalance = rbById.get(e.id);
  }

  // ── Filter ──
  let filtered = entries;
  if (clientFilter) filtered = filtered.filter((e) => e.clientName === clientFilter);
  if (typeFilter !== 'all') filtered = filtered.filter((e) => e.kind === typeFilter);
  if (monthFilter && /^\d{4}-\d{2}$/.test(monthFilter)) {
    filtered = filtered.filter((e) => (e.date ?? '').startsWith(monthFilter));
  }
  if (search) {
    filtered = filtered.filter((e) =>
      e.clientName.toLowerCase().includes(search) ||
      e.description.toLowerCase().includes(search) ||
      (e.reference ?? '').toLowerCase().includes(search),
    );
  }

  // Newest first; stable tiebreak by id so same-day entries don't jump around.
  filtered.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id));

  const totalCount = filtered.length;
  const rows = filtered.slice(0, limit);

  // Lightweight summary over the filtered set (not just the page).
  const summary = {
    billed: filtered.filter((e) => e.kind === 'billing').reduce((s, e) => s + e.amount, 0),
    paid: filtered.filter((e) => e.kind === 'payment').reduce((s, e) => s + e.amount, 0),
    deposits: filtered.filter((e) => e.kind === 'deposit').reduce((s, e) => s + e.amount, 0),
  };

  // Distinct client names for the filter dropdown.
  const clients = [...new Set(entries.map((e) => e.clientName).filter((n) => n && n !== '—'))].sort();

  return NextResponse.json({ entries: rows, totalCount, summary, clients, truncated, openingBalance, currentBalance });
}
