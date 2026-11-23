import type { SupabaseClient } from '@supabase/supabase-js';
import { invoiceGrossDue } from './invoice-amounts';
import {
  earlyPaymentCreditAmount,
  earlyPaymentCreditRef,
  earnsEarlyPaymentDiscount,
  readEarlyPaymentOffer,
  type EarlyPaymentRow,
} from '@/lib/billing/early-payment';
import { normalizeLetterDate } from '@/lib/billing/letter-format';

/**
 * Books — or takes back — an invoice's early-payment discount (see
 * lib/billing/early-payment.ts) as one `credit` payment, `EPD-<invoiceId>`.
 *
 * Two directions, called from two places:
 *
 *  - 'grant', after a payment is recorded against the invoice: if everything
 *    paid by the deadline now reaches the discounted figure, the credit is
 *    added and the invoice can settle as paid.
 *  - 'revoke', after payments change some other way (a payment undone, a credit
 *    reversed): if what remains no longer earns it, the credit comes out.
 *
 * Revoke never grants. When finance removes the discount credit itself, the
 * recompute that follows must not put it straight back — that is finance
 * deciding the client did not earn it, and only a new payment re-asks.
 */
export async function reconcileEarlyPaymentDiscount(
  supabase: SupabaseClient,
  firmId: string,
  invoiceId: number,
  recordedBy: string,
  direction: 'grant' | 'revoke',
): Promise<void> {
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, total_amount, total_expenses, billing_settings')
    .eq('id', invoiceId)
    .maybeSingle();
  const offer = readEarlyPaymentOffer(invoice?.billing_settings);
  if (!invoice || !offer) return;

  const { data: rows, error } = await supabase
    .from('invoice_payments')
    .select('id, amount, payment_date, payment_method, reference_number')
    .eq('invoice_id', invoiceId);
  if (error) throw new Error(`Failed to read payments on invoice ${invoiceId}: ${error.message}`);
  const payments = (rows ?? []) as (EarlyPaymentRow & { id: number })[];

  const ref = earlyPaymentCreditRef(invoiceId);
  const existing = payments.find((p) => p.reference_number === ref);
  const grossDue = invoiceGrossDue(invoice);
  const earned = earnsEarlyPaymentDiscount(offer, grossDue, payments, ref);

  if (existing && !earned) {
    const { error: delErr } = await supabase.from('invoice_payments').delete().eq('id', existing.id);
    if (delErr) throw new Error(`Failed to take back the early-payment discount on invoice ${invoiceId}: ${delErr.message}`);
    return;
  }
  if (existing || !earned || direction !== 'grant') return;

  const amount = earlyPaymentCreditAmount(offer, grossDue, payments, ref);
  if (amount <= 0) return;
  // Dated the day the discount was earned: the last payment made in time.
  const earnedOn = payments
    .filter((p) => p.reference_number !== ref && p.payment_date && p.payment_date.slice(0, 10) <= offer.deadline)
    .map((p) => p.payment_date!.slice(0, 10))
    .sort()
    .pop() ?? offer.deadline;

  const { error: insErr } = await supabase.from('invoice_payments').insert({
    firm_id: firmId,
    invoice_id: invoiceId,
    amount,
    payment_date: earnedOn,
    payment_method: 'credit',
    reference_number: ref,
    notes: `Early-payment discount — ${offer.percent}% of legal fees, paid by ${normalizeLetterDate(offer.deadline)}`,
    recorded_by: recordedBy,
  });
  if (insErr) throw new Error(`Failed to book the early-payment discount on invoice ${invoiceId}: ${insErr.message}`);
}
