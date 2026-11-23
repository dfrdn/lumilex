import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { invoiceGrossDue } from '@/lib/finance/invoice-amounts';

interface InvoiceRow {
  id: number;
  invoice_number: string;
  client_name: string;
  matter_name: string | null;
  billing_month: string;
  total_amount: number;
  total_expenses: number;
  paid_amount: number;
  status: string;
  sent_date: string | null;
  due_date: string | null;
  created_at: string;
  billing_settings: { includeVAT?: boolean | string | null } | null;
}

function getAgingBucket(daysOutstanding: number): string {
  if (daysOutstanding <= 0) return 'current';
  if (daysOutstanding <= 30) return '1-30';
  if (daysOutstanding <= 60) return '31-60';
  if (daysOutstanding <= 90) return '61-90';
  return '90+';
}

/**
 * GET /api/finance/receivables
 * Returns accounts receivable aging data.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'partner', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const clientFilter = params.get('clientId');

  const supabase = await getSupabaseServerAuthClient();

  // Unpaid SENT invoices (and partials). Drafts aren't receivables — they
  // haven't been billed to the client — so they're excluded from the A/R view
  // and the running balance. Legacy fully-'paid'-but-not rows are added below.
  let query = supabase
    .from('invoices')
    .select('id, invoice_number, client_name, matter_name, billing_month, total_amount, total_expenses, paid_amount, status, sent_date, due_date, created_at, billing_settings')
    .in('status', ['sent', 'partial']);

  if (clientFilter) {
    query = query.eq('client_name', clientFilter);
  }

  const { data: invoices, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also include "paid" invoices that weren't fully paid (legacy data before
  // the partial status existed).
  const { data: legacyPartial } = await supabase
    .from('invoices')
    .select('id, invoice_number, client_name, matter_name, billing_month, total_amount, total_expenses, paid_amount, status, sent_date, due_date, created_at, billing_settings')
    .eq('status', 'paid')
    .gt('paid_amount', 0);

  const legacyPartialInvoices = (legacyPartial ?? []).filter((inv: InvoiceRow) => {
    const totalDue = invoiceGrossDue(inv);
    return Number(inv.paid_amount) < totalDue;
  });

  const allInvoices = [...(invoices ?? []), ...legacyPartialInvoices] as InvoiceRow[];

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  // Clients flagged "unlikely to pay" — their balances are excluded from the
  // collectible headline total and aging, and surfaced separately as doubtful.
  const { data: riskRows } = await supabase
    .from('clients')
    .select('name')
    .eq('collection_risk', true);
  const riskSet = new Set((riskRows ?? []).map((r) => r.name as string));

  // Process each invoice
  const processed = allInvoices.map((inv) => {
    const totalDue = invoiceGrossDue(inv);
    const balance = totalDue - Number(inv.paid_amount);
    const referenceDate = inv.sent_date ?? inv.created_at?.split('T')[0] ?? todayStr;
    const daysOutstanding = Math.floor(
      (today.getTime() - new Date(referenceDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)
    );
    const bucket = inv.due_date
      ? (todayStr <= inv.due_date ? 'current' : getAgingBucket(daysOutstanding))
      : getAgingBucket(daysOutstanding);

    return {
      ...inv,
      totalDue,
      balance,
      daysOutstanding: Math.max(0, daysOutstanding),
      bucket,
    };
  }).filter((inv) => inv.balance > 0);

  // Group by client
  const byClient: Record<string, typeof processed> = {};
  for (const inv of processed) {
    const client = inv.client_name || 'Unknown';
    if (!byClient[client]) byClient[client] = [];
    byClient[client].push(inv);
  }

  // Compute bucket summaries. Doubtful clients (collection_risk) are kept out of
  // the collectible aging and rolled into a separate doubtful total instead.
  const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  let doubtfulTotal = 0;
  for (const inv of processed) {
    if (riskSet.has(inv.client_name)) {
      doubtfulTotal += inv.balance;
      continue;
    }
    buckets[inv.bucket as keyof typeof buckets] += inv.balance;
  }

  const totalOutstanding = processed.reduce(
    (s, inv) => s + (riskSet.has(inv.client_name) ? 0 : inv.balance), 0,
  );
  doubtfulTotal = Math.round(doubtfulTotal * 100) / 100;

  // Fetch payment history for these invoices
  const invoiceIds = processed.map((i) => i.id);
  let payments: Record<string, unknown>[] = [];
  if (invoiceIds.length > 0) {
    const { data: paymentData } = await supabase
      .from('invoice_payments')
      .select('*')
      .in('invoice_id', invoiceIds)
      .order('payment_date', { ascending: false });
    payments = paymentData ?? [];
  }

  const paymentsByInvoice: Record<number, Record<string, unknown>[]> = {};
  for (const p of payments) {
    const invId = p.invoice_id as number;
    if (!paymentsByInvoice[invId]) paymentsByInvoice[invId] = [];
    paymentsByInvoice[invId].push(p);
  }

  // Surface the full client roster for the A/R breakdown: every Active or
  // Inactive client (so finance sees them grouped by status, even with no open
  // balance), plus any client carrying a manual receivables override regardless
  // of status — money owed doesn't disappear because a client is flagged
  // Prospective. Prospective clients with no balance are intentionally left out
  // (never-engaged leads, not receivables). A Prospective client that does carry
  // a balance is folded into the Inactive bucket below.
  const { data: clientBalanceRows } = await supabase
    .from('clients')
    .select('name, status, receivables, deposit_balance, collection_risk, receivables_note, receivables_as_of, receivables_updated_at, receivables_updated_by, contact_email')
    .or('status.eq.Active,status.eq.Inactive,receivables.not.is.null,deposit_balance.gt.0')
    .order('name');

  const clientRows = clientBalanceRows ?? [];

  const balancesByClient: Record<string, {
    receivables: number | null;
    receivables_note: string | null;
    receivables_as_of: string | null;
    receivables_updated_at: string | null;
    receivables_updated_by: string | null;
  }> = {};
  const depositBalancesByClient: Record<string, number> = {};
  const collectionRiskByClient: Record<string, boolean> = {};
  // Two-bucket grouping for the UI: 'Active' clients in their own section, and
  // everything else surfaced here (Inactive, plus any Prospective that carries
  // a balance) folded into 'Inactive'.
  const clientStatus: Record<string, 'Active' | 'Inactive'> = {};
  for (const c of (clientRows ?? []) as Array<{
    name: string;
    status: string | null;
    receivables: number | null;
    deposit_balance: number | null;
    collection_risk: boolean | null;
    receivables_note: string | null;
    receivables_as_of: string | null;
    receivables_updated_at: string | null;
    receivables_updated_by: string | null;
  }>) {
    if (!c.name) continue;
    clientStatus[c.name] = c.status === 'Active' ? 'Active' : 'Inactive';
    if (c.collection_risk) collectionRiskByClient[c.name] = true;
    const recv = c.receivables === null ? null : Number(c.receivables);
    if (recv !== null) {
      balancesByClient[c.name] = {
        receivables: recv,
        receivables_note: c.receivables_note,
        receivables_as_of: c.receivables_as_of,
        receivables_updated_at: c.receivables_updated_at,
        receivables_updated_by: c.receivables_updated_by,
      };
    }
    // Deposit on hand is its own bucket now (clients.deposit_balance), no longer
    // inferred from a negative receivable.
    const onHand = Number(c.deposit_balance ?? 0);
    if (onHand > 0.005) {
      depositBalancesByClient[c.name] = onHand;
    }
  }

  // Recent deposit ledger entries for any client surfaced in this report,
  // capped per client so the payload stays small.
  const surfaceClients = Array.from(new Set([
    ...Object.keys(byClient),
    ...Object.keys(balancesByClient),
    ...Object.keys(depositBalancesByClient),
  ]));
  const depositLedgerByClient: Record<string, Array<{
    id: number;
    type: string;
    amount: number;
    transaction_date: string;
    payment_method: string;
    reference_number: string;
    notes: string;
    invoice_id: number | null;
    recorded_by: string;
  }>> = {};
  if (surfaceClients.length > 0) {
    const { data: ledgerRows } = await supabase
      .from('client_deposits')
      .select('id, client_name, type, amount, transaction_date, payment_method, reference_number, notes, invoice_id, recorded_by, created_at')
      .in('client_name', surfaceClients)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false });
    for (const row of (ledgerRows ?? []) as Array<{
      id: number;
      client_name: string;
      type: string;
      amount: number;
      transaction_date: string;
      payment_method: string;
      reference_number: string;
      notes: string;
      invoice_id: number | null;
      recorded_by: string;
    }>) {
      const list = depositLedgerByClient[row.client_name] ??= [];
      // Generous per-client cap: the inline statement builds its running balance
      // from these rows, so a low cap would make its opening plug diverge from
      // the full statement page. 500 covers any realistic client ledger.
      if (list.length < 500) {
        list.push({
          id: row.id,
          type: row.type,
          amount: Number(row.amount),
          transaction_date: row.transaction_date,
          payment_method: row.payment_method,
          reference_number: row.reference_number,
          notes: row.notes,
          invoice_id: row.invoice_id,
          recorded_by: row.recorded_by,
        });
      }
    }
  }

  // Every client-with-a-balance name, sorted, for the deposit modal + the
  // client section in the breakdown.
  const activeClientNames = clientRows
    .map((c) => c.name)
    .filter((n): n is string => !!n);

  // Net deposits per client (deposit/refund/adjustment) for the "X in deposits"
  // indicator. 'application' rows are excluded — they mirror an invoice payment,
  // so counting them here would make the figure shrink as deposits get applied
  // and disagree with the Ledger page (which also excludes applications).
  // 'payment' rows (on-account paydowns of the running balance) are excluded too
  // — they're not deposits on hand, they reduce what the client owes.
  const { data: ledgerNetRows } = await supabase
    .from('client_deposits')
    .select('client_name, amount')
    .neq('type', 'application')
    .neq('type', 'payment')
    .limit(10000);
  const depositLedgerNetByClient: Record<string, number> = {};
  for (const r of (ledgerNetRows ?? []) as Array<{ client_name: string; amount: number }>) {
    if (!r.client_name) continue;
    depositLedgerNetByClient[r.client_name] = (depositLedgerNetByClient[r.client_name] ?? 0) + Number(r.amount);
  }

  return NextResponse.json({
    invoices: processed,
    byClient,
    buckets,
    totalOutstanding,
    doubtfulTotal,
    collectionRiskByClient,
    paymentsByInvoice,
    balancesByClient,
    depositBalancesByClient,
    depositLedgerByClient,
    depositLedgerNetByClient,
    activeClientNames,
    clientStatus,
  });
}
