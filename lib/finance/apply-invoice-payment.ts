import type { SupabaseClient } from '@supabase/supabase-js';
import { invoiceGrossDue } from './invoice-amounts';
import { reconcileEarlyPaymentDiscount } from './early-payment-discount';

export interface InvoicePaymentMeta {
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string;
  notes: string;
  recordedBy: string;
}

/**
 * Insert an invoice_payments row and roll the invoice's paid_amount / status
 * forward. Shared by the per-invoice "record payment" action and the on-account
 * allocator so the paid/partial transition lives in exactly one place.
 */
export async function applyInvoicePayment(
  supabase: SupabaseClient,
  firmId: string,
  invoiceId: number,
  amount: number,
  meta: InvoicePaymentMeta,
): Promise<{ ok: true; newPaidAmount: number; fullyPaid: boolean } | { ok: false; error: string }> {
  // firmId is a required parameter rather than derived: one caller hands this
  // helper a firm-scoped client (which stamps firm_id itself) and another the
  // authed client (which does not), so the row carries it either way.
  const { error: payError } = await supabase.from('invoice_payments').insert({
    firm_id: firmId,
    invoice_id: invoiceId,
    amount,
    payment_date: meta.paymentDate,
    payment_method: meta.paymentMethod,
    reference_number: meta.referenceNumber,
    notes: meta.notes,
    recorded_by: meta.recordedBy,
  });
  if (payError) return { ok: false, error: payError.message };

  // The payment is recorded. If what follows fails, report it as recorded
  // anyway — an error here would invite a retry and a duplicate payment. The
  // discount and the status catch up on the invoice's next payment or
  // recompute.
  //
  // A payment made in time for the early-payment discount books the discount
  // first, so the invoice settles as paid rather than partial.
  try {
    await reconcileEarlyPaymentDiscount(supabase, firmId, invoiceId, meta.recordedBy, 'grant');
  } catch (e) {
    console.error('[apply-invoice-payment] early-payment discount:', e instanceof Error ? e.message : e);
  }
  let settled: Awaited<ReturnType<typeof settleInvoiceStatus>> = null;
  try {
    settled = await settleInvoiceStatus(supabase, invoiceId, meta.paymentDate);
  } catch (e) {
    console.error('[apply-invoice-payment] settle status:', e instanceof Error ? e.message : e);
  }

  return { ok: true, newPaidAmount: settled?.paidAmount ?? amount, fullyPaid: settled?.status === 'paid' };
}

/**
 * Recompute an invoice's paid_amount + status from its surviving invoice_payments
 * rows (the source of truth). Used after deleting payments — on-account reversal
 * or per-receipt rollback — so the figures never drift. A 'paid'/'partial'
 * invoice that loses all its payments falls back to 'sent'.
 */
export async function recomputeInvoicePaid(
  supabase: SupabaseClient,
  firmId: string,
  invoiceId: number,
  recordedBy = 'system',
): Promise<void> {
  // A payment undone can take the early-payment discount with it.
  await reconcileEarlyPaymentDiscount(supabase, firmId, invoiceId, recordedBy, 'revoke');
  await settleInvoiceStatus(supabase, invoiceId);
}

/**
 * paid_amount and status from the payments on record. `paidDate` is the day a
 * payment that settles the invoice was made; without one, a paid invoice keeps
 * the date it has.
 */
async function settleInvoiceStatus(
  supabase: SupabaseClient,
  invoiceId: number,
  paidDate?: string,
): Promise<{ paidAmount: number; status: string } | null> {
  const { data: pays } = await supabase
    .from('invoice_payments')
    .select('amount')
    .eq('invoice_id', invoiceId);
  const paid = Math.round((pays ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount), 0) * 100) / 100;

  const { data: invoice } = await supabase
    .from('invoices')
    .select('total_amount, total_expenses, status, billing_settings')
    .eq('id', invoiceId)
    .single();
  if (!invoice) return null;

  const inv = invoice as { total_amount: number; total_expenses: number; status: string };
  // VAT-inclusive — a fully-paid VAT invoice settles its gross total, not the
  // pre-VAT figure, so the paid/partial threshold must use the gross due.
  const totalDue = invoiceGrossDue(invoice);
  let status = inv.status;
  if (paid <= 0.005) {
    if (status === 'paid' || status === 'partial') status = 'sent';
  } else if (paid + 0.01 >= totalDue) {
    status = 'paid';
  } else {
    status = 'partial';
  }

  const update: Record<string, unknown> = { paid_amount: paid, status, updated_at: new Date().toISOString() };
  // Reverting away from 'paid' must clear the stale paid_date, else a reversed
  // invoice still reads as paid-on-that-date in reports.
  if (status !== 'paid') update.paid_date = null;
  else if (paidDate) update.paid_date = paidDate;
  const { error } = await supabase.from('invoices').update(update).eq('id', invoiceId);
  // The caller treats a resolved promise as success; a swallowed update error
  // would leave paid_amount/status stale after a payment or credit. Surface it.
  if (error) throw new Error(`Failed to recompute invoice paid amount: ${error.message}`);
  return { paidAmount: paid, status };
}
