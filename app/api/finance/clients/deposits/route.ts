import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

interface DepositRow {
  id: number;
  client_id: string | null;
  client_name: string;
  type: 'deposit' | 'application' | 'refund' | 'adjustment';
  amount: number;
  transaction_date: string;
  payment_method: string;
  reference_number: string;
  notes: string;
  invoice_id: number | null;
  recorded_by: string;
  created_at: string;
}

function canRead(role?: string) {
  return ['admin', 'super_user', 'partner', 'finance'].includes(role ?? '');
}
function canWrite(role?: string) {
  return role === 'finance' || role === 'super_user';
}

/**
 * GET /api/finance/clients/deposits
 *   ?clientName=Acme        — return ledger for a single client (newest first)
 *   (no client)             — return per-client deposit balances summary
 *
 * Response (with clientName):
 *   { ledger: DepositRow[], balance, clientName }
 *
 * Response (no clientName):
 *   { balancesByClient: Record<clientName, { deposit_balance: number }> }
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canRead(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const clientName = req.nextUrl.searchParams.get('clientName');

  // Deposit on hand is its own bucket (clients.deposit_balance), independent of
  // amount due (clients.receivables). A fresh deposit raises on-hand without
  // touching what the client owes; applying it to an invoice draws it down.
  if (clientName) {
    const [ledgerRes, clientRes] = await Promise.all([
      supabase
        .from('client_deposits')
        .select('*')
        .eq('client_name', clientName)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('clients')
        .select('name, receivables, deposit_balance')
        .eq('name', clientName)
        .maybeSingle(),
    ]);
    if (ledgerRes.error) {
      return NextResponse.json({ error: ledgerRes.error.message }, { status: 500 });
    }
    return NextResponse.json({
      clientName,
      ledger: (ledgerRes.data ?? []) as DepositRow[],
      receivables: Number(clientRes.data?.receivables ?? 0),
      depositBalance: Number(clientRes.data?.deposit_balance ?? 0),
    });
  }

  // All clients holding a deposit on file (positive trust balance).
  const { data, error } = await supabase
    .from('clients')
    .select('name, deposit_balance')
    .gt('deposit_balance', 0);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const balancesByClient: Record<string, { deposit_balance: number }> = {};
  for (const c of (data ?? []) as Array<{ name: string; deposit_balance: number }>) {
    if (!c.name) continue;
    balancesByClient[c.name] = { deposit_balance: Number(c.deposit_balance ?? 0) };
  }
  return NextResponse.json({ balancesByClient });
}

/**
 * POST /api/finance/clients/deposits
 * Body: {
 *   clientName: string,
 *   type: 'deposit' | 'refund' | 'adjustment',
 *   amount: number,                // positive number always; sign is derived
 *   transactionDate?: 'YYYY-MM-DD',
 *   paymentMethod?: string,
 *   referenceNumber?: string,
 *   notes?: string,
 * }
 *
 * 'deposit'    → +amount (credit to client)
 * 'refund'     → -amount (debit; rejects if balance < amount)
 * 'adjustment' → caller may pass `signedAmount` for explicit sign,
 *                otherwise treated as +amount.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const {
    clientName,
    type,
    amount,
    signedAmount,
    transactionDate,
    paymentMethod,
    referenceNumber,
    notes,
  } = body;

  if (!clientName || typeof clientName !== 'string') {
    return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  }
  if (!['deposit', 'refund', 'adjustment'].includes(type)) {
    return NextResponse.json({ error: 'type must be deposit, refund or adjustment' }, { status: 400 });
  }
  const baseAmt = Number(amount);
  if (!Number.isFinite(baseAmt) || baseAmt <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
  }

  let signed: number;
  if (type === 'deposit') {
    signed = baseAmt;
  } else if (type === 'refund') {
    signed = -baseAmt;
  } else {
    const explicit = Number(signedAmount);
    signed = Number.isFinite(explicit) && explicit !== 0 ? explicit : baseAmt;
  }

  const supabase = await getSupabaseServerAuthClient();

  // Find client row (for client_id + sanity check that the name exists)
  const { data: clientRow } = await supabase
    .from('clients')
    .select('notion_id, name, deposit_balance')
    .eq('name', clientName)
    .maybeSingle();
  if (!clientRow) {
    return NextResponse.json({ error: `Client "${clientName}" not found` }, { status: 404 });
  }

  // Refunds (and negative adjustments) draw down the deposit on hand. Block any
  // that would push the trust balance below zero.
  if ((type === 'refund' || (type === 'adjustment' && signed < 0))) {
    const onHand = Number(clientRow.deposit_balance ?? 0);
    if (onHand + signed < -0.01) {
      return NextResponse.json(
        { error: `Insufficient deposit on hand (₱${onHand.toFixed(2)}) for this ${type}.` },
        { status: 400 },
      );
    }
  }

  const recordedBy = session.user.name ?? session.user.email ?? 'unknown';

  const { data: inserted, error } = await supabase
    .from('client_deposits')
    .insert({
      firm_id: session.firmId,
      client_id: clientRow.notion_id ?? null,
      client_name: clientName,
      type,
      amount: signed,
      transaction_date: transactionDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }),
      payment_method: paymentMethod ?? '',
      reference_number: referenceNumber ?? '',
      notes: notes ?? '',
      recorded_by: recordedBy,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[finance-deposits POST]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Trigger has updated clients.deposit_balance (and leaves amount due alone).
  const { data: updated } = await supabase
    .from('clients')
    .select('receivables, deposit_balance')
    .eq('name', clientName)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    deposit: inserted,
    receivables: Number(updated?.receivables ?? 0),
    depositBalance: Number(updated?.deposit_balance ?? 0),
  });
}

/**
 * PATCH /api/finance/clients/deposits
 * Edit an existing ledger entry. Body: { id, type, amount, signedAmount?,
 * transactionDate?, paymentMethod?, referenceNumber?, notes? }. 'application'
 * entries can't be edited here (they mirror an invoice payment). The
 * receivables trigger recomputes the client balance from the new amount.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { id, type, amount, signedAmount, transactionDate, paymentMethod, referenceNumber, notes } = body;

  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  if (!['deposit', 'refund', 'adjustment'].includes(type)) {
    return NextResponse.json({ error: 'type must be deposit, refund or adjustment' }, { status: 400 });
  }
  const baseAmt = Number(amount);
  if (!Number.isFinite(baseAmt) || baseAmt <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
  }

  let signed: number;
  if (type === 'deposit') {
    signed = baseAmt;
  } else if (type === 'refund') {
    signed = -baseAmt;
  } else {
    const explicit = Number(signedAmount);
    signed = Number.isFinite(explicit) && explicit !== 0 ? explicit : baseAmt;
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data: existing } = await supabase
    .from('client_deposits')
    .select('id, type, amount, client_name')
    .eq('id', rowId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  if (existing.type === 'application') {
    return NextResponse.json(
      { error: "Applied-deposit entries can't be edited here — adjust the linked invoice payment instead." },
      { status: 409 },
    );
  }

  // Same overdraw guard the POST path enforces: a refund / negative adjustment
  // can't draw the deposit on hand below zero. Compute on-hand as if this row
  // were removed (the trigger applied `deposit_balance += existing.amount`),
  // then check the new amount against it.
  if (type === 'refund' || (type === 'adjustment' && signed < 0)) {
    const { data: cur } = await supabase
      .from('clients')
      .select('deposit_balance')
      .eq('name', existing.client_name)
      .maybeSingle();
    const onHandWithoutThis = Number(cur?.deposit_balance ?? 0) - Number(existing.amount);
    if (onHandWithoutThis + signed < -0.01) {
      return NextResponse.json(
        { error: `Insufficient deposit on hand (₱${onHandWithoutThis.toFixed(2)}) for this ${type}.` },
        { status: 400 },
      );
    }
  }

  const { data: updated, error } = await supabase
    .from('client_deposits')
    .update({
      type,
      amount: signed,
      ...(transactionDate ? { transaction_date: transactionDate } : {}),
      payment_method: type === 'adjustment' ? '' : (paymentMethod ?? ''),
      reference_number: referenceNumber ?? '',
      notes: notes ?? '',
    })
    .eq('id', rowId)
    .select('*')
    .single();
  if (error) {
    console.error('[finance-deposits PATCH]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Trigger has recomputed clients.deposit_balance; read it back.
  const { data: clientRow } = await supabase
    .from('clients')
    .select('receivables, deposit_balance')
    .eq('name', existing.client_name)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    deposit: updated,
    receivables: Number(clientRow?.receivables ?? 0),
    depositBalance: Number(clientRow?.deposit_balance ?? 0),
  });
}

/**
 * DELETE /api/finance/clients/deposits?id=123
 * Reverses a single ledger row. Application entries can't be deleted via this
 * route — finance must reverse them by deleting the underlying invoice_payments
 * row from the receivables view (handled separately).
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const idParam = req.nextUrl.searchParams.get('id');
  const id = idParam ? parseInt(idParam) : NaN;
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data: row } = await supabase
    .from('client_deposits')
    .select('id, type, client_name, invoice_id')
    .eq('id', id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.type === 'application') {
    return NextResponse.json(
      { error: 'Cannot delete an application directly — reverse the linked invoice payment instead.' },
      { status: 409 },
    );
  }

  const { error } = await supabase.from('client_deposits').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
