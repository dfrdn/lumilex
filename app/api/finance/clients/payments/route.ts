import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, onAccountPaymentSchema } from '@/lib/validation';
import { applyInvoicePayment, recomputeInvoicePaid } from '@/lib/finance/apply-invoice-payment';
import { isAfterAnchor } from '@/lib/finance/client-balance';
import { invoiceOpenBalance } from '@/lib/finance/invoice-amounts';
import { logAudit, getClientIP } from '@/lib/audit';

/**
 * POST /api/finance/clients/payments
 * Records an on-account payment toward a client's overall running balance and
 * allocates it OLDEST-FIRST:
 *   1. the opening / brought-forward lump (positive clients.receivables) — booked
 *      as a client_deposits row of type 'payment' so the trigger draws it down;
 *   2. then sent/partial invoices in chronological order — booked as ordinary
 *      invoice_payments rows (status flips to partial/paid);
 *   3. any surplus becomes an advance deposit credit (type 'deposit').
 * Every row of one receipt shares a generated reference (`OA-<ts>`) so the whole
 * receipt can be reversed via DELETE.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, onAccountPaymentSchema);
  if (!validation.success) return validation.response;
  const { clientName, amount, paymentDate, paymentMethod, referenceNumber, notes } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const recordedBy = session.user.name ?? session.user.email ?? 'unknown';

  const { data: clientRow } = await supabase
    .from('clients')
    .select('notion_id, name, receivables, receivables_as_of')
    .eq('name', clientName)
    .maybeSingle();
  if (!clientRow) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  // Opening lump remaining = the positive (non-invoice) part of the running
  // balance. Negative receivables means the client is already in credit.
  const openingRemaining = Math.max(0, Number(clientRow.receivables ?? 0));
  const receivablesAsOf = (clientRow.receivables_as_of as string | null) ?? null;

  const { data: invoiceRows } = await supabase
    .from('invoices')
    .select('id, invoice_number, billing_month, total_amount, total_expenses, paid_amount, sent_date, created_at, billing_settings')
    .eq('client_name', clientName)
    .in('status', ['sent', 'partial'])
    .order('billing_month', { ascending: true })
    .order('sent_date', { ascending: true, nullsFirst: true });
  const openInvoices = (invoiceRows ?? [])
    .map((r) => ({
      id: r.id as number,
      invoiceNumber: r.invoice_number as string,
      billingMonth: (r.billing_month as string) ?? '',
      balance: invoiceOpenBalance(r),
      sentDate: (r.sent_date as string | null) ?? null,
      createdDate: typeof r.created_at === 'string' ? r.created_at.split('T')[0] : null,
    }))
    .filter((i) => i.balance > 0.005);
  // Only invoices that carry forward ON TOP of the opening are payable here —
  // pre-anchor invoices are already folded into the opening lump, so paying both
  // would double-count. Same after-anchor rule the running balance uses.
  const targetInvoices = openingRemaining > 0.005 && receivablesAsOf
    ? openInvoices.filter((i) => isAfterAnchor(i, receivablesAsOf, receivablesAsOf.slice(0, 7)))
    : openInvoices;

  // Collision-proof receipt id (time + randomness) so two receipts can't share a
  // ref and have DELETE/rollback clobber each other.
  const groupRef = `OA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const sharedNotes = [notes, referenceNumber ? `Ref: ${referenceNumber}` : '']
    .filter(Boolean)
    .join(' · ');

  const allocations: Array<{ target: string; amount: number; fullyPaid?: boolean }> = [];
  const touchedInvoiceIds: number[] = [];
  let remaining = amount;

  const rollback = async () => {
    await supabase.from('invoice_payments').delete().eq('reference_number', groupRef);
    for (const id of touchedInvoiceIds) await recomputeInvoicePaid(supabase, session.firmId, id);
    await supabase.from('client_deposits').delete().eq('reference_number', groupRef);
  };

  // 1. Opening lump first.
  const toOpening = Math.round(Math.min(remaining, openingRemaining) * 100) / 100;
  if (toOpening > 0.005) {
    const { error } = await supabase.from('client_deposits').insert({
      firm_id: session.firmId,
      client_id: clientRow.notion_id ?? null,
      client_name: clientName,
      type: 'payment',
      amount: toOpening, // +amount → trigger: receivables -= amount
      transaction_date: paymentDate,
      payment_method: paymentMethod,
      reference_number: groupRef,
      notes: sharedNotes || 'On-account payment (opening balance)',
      recorded_by: recordedBy,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    remaining -= toOpening;
    allocations.push({ target: 'Opening balance', amount: toOpening });
  }

  // 2. Billed invoices, oldest first.
  for (const inv of targetInvoices) {
    if (remaining <= 0.005) break;
    const slice = Math.round(Math.min(remaining, inv.balance) * 100) / 100;
    const res = await applyInvoicePayment(supabase, session.firmId, inv.id, slice, {
      paymentDate,
      paymentMethod,
      referenceNumber: groupRef,
      notes: sharedNotes || 'On-account payment',
      recordedBy,
    });
    if (!res.ok) {
      await rollback();
      return NextResponse.json({ error: res.error }, { status: 500 });
    }
    touchedInvoiceIds.push(inv.id);
    remaining -= slice;
    allocations.push({ target: inv.invoiceNumber, amount: slice, fullyPaid: res.fullyPaid });
  }

  // 3. Surplus → advance deposit credit.
  let surplus = 0;
  if (remaining > 0.005) {
    surplus = Math.round(remaining * 100) / 100;
    const { error } = await supabase.from('client_deposits').insert({
      firm_id: session.firmId,
      client_id: clientRow.notion_id ?? null,
      client_name: clientName,
      type: 'deposit',
      amount: surplus,
      transaction_date: paymentDate,
      payment_method: paymentMethod,
      reference_number: groupRef,
      notes: sharedNotes ? `${sharedNotes} (overpayment credit)` : 'On-account overpayment credit',
      recorded_by: recordedBy,
    });
    if (error) {
      await rollback();
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    allocations.push({ target: 'Advance deposit credit', amount: surplus });
  }

  const { data: after } = await supabase
    .from('clients')
    .select('receivables')
    .eq('name', clientName)
    .maybeSingle();

  logAudit({
    firmId: session.firmId,
    entityType: 'OnAccountPayment',
    entityId: groupRef,
    entityName: clientName,
    action: 'recorded',
    newValue: String(amount),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    success: true,
    groupRef,
    allocations,
    surplus,
    newReceivables: Number(after?.receivables ?? 0),
  });
}

/**
 * DELETE /api/finance/clients/payments?ref=OA-...
 * Reverses an entire on-account receipt: removes its invoice_payments (then
 * recomputes those invoices), and its client_deposits rows (trigger restores
 * clients.receivables).
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const groupRef = req.nextUrl.searchParams.get('ref');
  if (!groupRef || !groupRef.startsWith('OA-')) {
    return NextResponse.json({ error: 'A valid on-account receipt ref is required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data: pays } = await supabase
    .from('invoice_payments')
    .select('invoice_id')
    .eq('reference_number', groupRef);
  const invoiceIds = Array.from(new Set((pays ?? []).map((p) => (p as { invoice_id: number }).invoice_id)));

  const { error: payDelErr } = await supabase.from('invoice_payments').delete().eq('reference_number', groupRef);
  if (payDelErr) return NextResponse.json({ error: payDelErr.message }, { status: 500 });
  for (const id of invoiceIds) await recomputeInvoicePaid(supabase, session.firmId, id);
  // Deleting the ledger rows fires the trigger that restores clients.receivables.
  const { error: depDelErr } = await supabase.from('client_deposits').delete().eq('reference_number', groupRef);
  if (depDelErr) return NextResponse.json({ error: depDelErr.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'OnAccountPayment',
    entityId: groupRef,
    action: 'reversed',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true });
}
