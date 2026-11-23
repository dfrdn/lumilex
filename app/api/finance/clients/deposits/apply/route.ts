import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { applyDepositToInvoice } from '@/lib/finance/deposit-apply';

/**
 * POST /api/finance/clients/deposits/apply
 * Body: { invoiceId: number, amount: number, notes?: string }
 *
 * Pays an invoice from the client's deposit balance via the shared
 * applyDepositToInvoice helper (invoice_payments + client_deposits application
 * + paid_amount/status roll-forward).
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

  const body = await req.json();
  const { invoiceId, amount, notes } = body;

  const amt = Number(amount);
  if (!invoiceId || !Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: 'invoiceId and positive amount required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('id, client_id, client_name, total_amount, total_expenses, paid_amount, invoice_number, billing_settings')
    .eq('id', invoiceId)
    .maybeSingle();
  if (invErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const result = await applyDepositToInvoice(supabase, session.firmId, invoice, amt, {
    recordedBy: session.user.name ?? session.user.email ?? 'unknown',
    notes: notes ? `${notes} (applied from deposit)` : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.code === 'validation' ? 400 : 500 });
  }

  const { data: updatedClient } = await supabase
    .from('clients')
    .select('receivables, deposit_balance')
    .eq('name', invoice.client_name)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    invoiceId,
    appliedAmount: result.appliedAmount,
    newPaidAmount: result.newPaidAmount,
    fullyPaid: result.fullyPaid,
    newReceivables: Number(updatedClient?.receivables ?? 0),
    newDepositBalance: Number(updatedClient?.deposit_balance ?? 0),
  });
}
