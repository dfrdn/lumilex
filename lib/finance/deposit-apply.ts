/**
 * Pay an invoice from the client's advance deposit — the ONE place the
 * three-row application is written, shared by the manual "Apply deposit"
 * action (/api/finance/clients/deposits/apply) and the auto-settle that runs
 * when a settle-from-deposit invoice is sent.
 *
 *   1. invoice_payments row with method='deposit'.
 *   2. client_deposits ledger row (type='application', negative amount) —
 *      its trigger draws down clients.deposit_balance.
 *   3. invoices.paid_amount + status roll-forward.
 *
 * Both rows share an APP-<invoiceId>-<ts> reference so the payments-modal undo
 * (DELETE /api/finance/invoices/payments) can reverse them together.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { invoiceGrossDue } from './invoice-amounts';
import { depositSettlementFromSnapshot } from './deposit-settlement';

export interface DepositApplyInvoice {
  id: number;
  client_id: string | null;
  client_name: string;
  invoice_number: string;
  total_amount: number | string | null;
  total_expenses: number | string | null;
  paid_amount: number | string | null;
  billing_settings: Record<string, unknown> | null;
}

export type DepositApplyResult =
  | { ok: true; appliedAmount: number; newPaidAmount: number; fullyPaid: boolean }
  | { ok: false; error: string; code: 'validation' | 'db' };

export async function applyDepositToInvoice(
  supabase: SupabaseClient,
  firmId: string,
  invoice: DepositApplyInvoice,
  amount: number,
  opts: { recordedBy: string; notes?: string },
): Promise<DepositApplyResult> {
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error: 'Positive amount required', code: 'validation' };
  }

  const totalDue = invoiceGrossDue(invoice);
  const remainingBalance = totalDue - Number(invoice.paid_amount ?? 0);
  if (amt > remainingBalance + 0.01) {
    return {
      ok: false,
      error: `Amount (₱${amt.toFixed(2)}) exceeds invoice balance (₱${remainingBalance.toFixed(2)}).`,
      code: 'validation',
    };
  }

  const { data: clientRow } = await supabase
    .from('clients')
    .select('notion_id, name, deposit_balance')
    .eq('name', invoice.client_name)
    .maybeSingle();
  const depositBalance = Number(clientRow?.deposit_balance ?? 0);
  if (depositBalance + 0.01 < amt) {
    return {
      ok: false,
      error: `Client deposit on hand (₱${depositBalance.toFixed(2)}) is less than amount to apply (₱${amt.toFixed(2)}).`,
      code: 'validation',
    };
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  // Shared token tying the invoice payment to its deposit-ledger application so
  // an undo can reverse both rows atomically (see DELETE /invoices/payments).
  const applyRef = `APP-${invoice.id}-${Date.now()}`;

  // firmId is a required parameter rather than derived: the auto-settle callers
  // hand this helper a firm-scoped client (which stamps firm_id itself) and the
  // manual apply handler the authed client (which does not).
  const { error: payErr } = await supabase.from('invoice_payments').insert({
    firm_id: firmId,
    invoice_id: invoice.id,
    amount: amt,
    payment_date: today,
    payment_method: 'deposit',
    reference_number: applyRef,
    notes: opts.notes ?? 'Applied from client deposit balance',
    recorded_by: opts.recordedBy,
  });
  if (payErr) {
    console.error('[deposit-apply] invoice_payments insert:', payErr.message);
    return { ok: false, error: payErr.message, code: 'db' };
  }

  const { error: ledgerErr } = await supabase.from('client_deposits').insert({
    firm_id: firmId,
    client_id: clientRow?.notion_id ?? invoice.client_id ?? null,
    client_name: invoice.client_name,
    type: 'application',
    amount: -amt,
    transaction_date: today,
    payment_method: 'deposit',
    reference_number: applyRef,
    notes: `Applied to invoice ${invoice.invoice_number}`,
    invoice_id: invoice.id,
    recorded_by: opts.recordedBy,
  });
  if (ledgerErr) {
    // Best-effort rollback of the invoice payment we just inserted.
    await supabase
      .from('invoice_payments')
      .delete()
      .eq('invoice_id', invoice.id)
      .eq('reference_number', applyRef);
    console.error('[deposit-apply] client_deposits insert:', ledgerErr.message);
    return { ok: false, error: ledgerErr.message, code: 'db' };
  }

  const newPaid = Number(invoice.paid_amount ?? 0) + amt;
  const fullyPaid = newPaid + 0.01 >= totalDue;
  const updateData: Record<string, unknown> = {
    paid_amount: newPaid,
    updated_at: new Date().toISOString(),
  };
  if (fullyPaid) {
    updateData.status = 'paid';
    updateData.paid_date = today;
  } else if (newPaid > 0) {
    updateData.status = 'partial';
  }
  await supabase.from('invoices').update(updateData).eq('id', invoice.id);

  return { ok: true, appliedAmount: amt, newPaidAmount: newPaid, fullyPaid };
}

export type AutoSettleCheck =
  | { status: 'skip'; reason: string }
  | { status: 'ready'; amount: number }
  | { status: 'blocked'; error: string };

/**
 * Read-only pre-send check for a settle-from-deposit invoice: does the frozen
 * depositApplied figure still hold against the live deposit balance?
 *
 * 'skip'    — nothing to auto-apply (setting off, already applied, nothing due).
 * 'ready'   — apply `amount` after the send succeeds.
 * 'blocked' — the live deposit no longer covers the printed figure; the caller
 *             must NOT send, or the client receives a letter whose settlement
 *             the books can't honor. Regenerating refreshes the figures.
 */
export async function checkDepositAutoSettle(
  supabase: SupabaseClient,
  invoice: DepositApplyInvoice,
): Promise<AutoSettleCheck> {
  const settlement = depositSettlementFromSnapshot(invoice.billing_settings);
  if (!settlement) return { status: 'skip', reason: 'not a settle-from-deposit invoice' };

  // Idempotence: one deposit application per invoice. A re-send (or a send
  // after regenerate, which keeps payments) must not draw the deposit twice.
  const { data: existing } = await supabase
    .from('invoice_payments')
    .select('id')
    .eq('invoice_id', invoice.id)
    .eq('payment_method', 'deposit')
    .limit(1);
  if (existing && existing.length > 0) {
    return { status: 'skip', reason: 'deposit already applied to this invoice' };
  }

  const openBalance = invoiceGrossDue(invoice) - Number(invoice.paid_amount ?? 0);
  const amount = Math.round(Math.min(settlement.applied, openBalance) * 100) / 100;
  if (amount <= 0.005) return { status: 'skip', reason: 'nothing left due on this invoice' };

  const { data: clientRow } = await supabase
    .from('clients')
    .select('deposit_balance')
    .eq('name', invoice.client_name)
    .maybeSingle();
  const depositBalance = Number(clientRow?.deposit_balance ?? 0);
  if (depositBalance + 0.01 < amount) {
    return {
      status: 'blocked',
      error:
        `The client's deposit on hand (₱${depositBalance.toFixed(2)}) no longer covers the ` +
        `₱${amount.toFixed(2)} this invoice was generated to settle from it. ` +
        'Regenerate the invoice to refresh the deposit figures, then send again.',
    };
  }

  return { status: 'ready', amount };
}
