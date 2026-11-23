import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { recomputeInvoicePaid } from '@/lib/finance/apply-invoice-payment';

/**
 * GET /api/finance/invoices/payments?invoiceId=<id>
 * List the payments recorded against one invoice (newest first), so any
 * invoice — including fully-paid ones absent from the A/R aging view — can have
 * its payments reviewed and undone.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['admin', 'super_user', 'partner', 'finance'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const invoiceId = Number(req.nextUrl.searchParams.get('invoiceId'));
  if (!Number.isFinite(invoiceId)) {
    return NextResponse.json({ error: 'invoiceId query param required' }, { status: 400 });
  }
  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('invoice_payments')
    .select('id, invoice_id, amount, payment_date, payment_method, reference_number, notes, recorded_by')
    .eq('invoice_id', invoiceId)
    .order('payment_date', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payments: data ?? [] });
}

/**
 * DELETE /api/finance/invoices/payments?id=<invoice_payment_id>
 * Undo a single invoice payment and roll the invoice's paid_amount/status back.
 *   • direct payment / credit → delete the row, recompute.
 *   • deposit application      → also delete the paired client_deposits row
 *                                (shared APP- reference, falling back to
 *                                invoice_id+amount) so the trigger restores the
 *                                client's deposit on hand.
 * On-account receipts (OA- ref) are reversed as a whole via
 * DELETE /api/finance/clients/payments — rejected here so a single allocation
 * can't be peeled off a multi-invoice receipt.
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

  const idParam = req.nextUrl.searchParams.get('id');
  const id = idParam ? Number(idParam) : NaN;
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data: pay } = await supabase
    .from('invoice_payments')
    .select('id, invoice_id, amount, payment_method, reference_number')
    .eq('id', id)
    .maybeSingle();
  if (!pay) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });

  const ref = typeof pay.reference_number === 'string' ? pay.reference_number : '';
  if (ref.startsWith('OA-')) {
    return NextResponse.json(
      { error: 'On-account receipts are reversed as a whole — use the deposit ledger Reverse action.' },
      { status: 409 },
    );
  }

  // A deposit application has a paired client_deposits row. Remove it first so
  // the trigger restores deposit_balance; matched by the shared APP- reference,
  // falling back to (invoice_id, amount) for legacy rows without one.
  if (pay.payment_method === 'deposit') {
    let delQuery = supabase.from('client_deposits').delete().eq('type', 'application');
    delQuery = ref.startsWith('APP-')
      ? delQuery.eq('reference_number', ref)
      : delQuery.eq('invoice_id', pay.invoice_id).eq('amount', -Number(pay.amount));
    const { error: ledgerErr } = await delQuery;
    if (ledgerErr) {
      console.error('[invoice-payments DELETE] ledger reverse:', ledgerErr.message);
      return NextResponse.json({ error: ledgerErr.message }, { status: 500 });
    }
  }

  const { error: delErr } = await supabase.from('invoice_payments').delete().eq('id', id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await recomputeInvoicePaid(supabase, session.firmId, pay.invoice_id);
  return NextResponse.json({ success: true });
}
