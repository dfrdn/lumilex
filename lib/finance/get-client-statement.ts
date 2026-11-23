import type { SupabaseClient } from '@supabase/supabase-js';
import { runningBalance, type BalanceInvoice } from './client-balance';
import { invoiceOpenBalance } from './invoice-amounts';
import { buildClientStatement, type ClientStatement } from './client-statement';

/**
 * Server-side assembly of one client's statement: fetch their sent invoices and
 * deposit ledger, compute the running balance, and build the dated statement.
 * Shared by the standalone statement page (and available to any other surface)
 * so the fetch + map + build lives in one place. Drafts are excluded — only sent
 * invoices count toward what a client owes.
 */
export async function getClientStatement(
  supabase: SupabaseClient,
  clientName: string,
): Promise<{ statement: ClientStatement; found: boolean }> {
  const { data: clientRow } = await supabase
    .from('clients')
    .select('receivables, receivables_as_of')
    .eq('name', clientName)
    .maybeSingle();

  const { data: invRows } = await supabase
    .from('invoices')
    .select('invoice_number, billing_month, total_amount, total_expenses, paid_amount, sent_date, created_at, billing_settings')
    .eq('client_name', clientName)
    .in('status', ['sent', 'partial', 'paid']);
  const invoices = (invRows ?? [])
    .map((r) => ({
      invoiceNumber: r.invoice_number as string,
      billingMonth: r.billing_month as string,
      balance: invoiceOpenBalance(r),
      sentDate: (r.sent_date as string | null) ?? null,
      createdDate: typeof r.created_at === 'string' ? r.created_at.split('T')[0] : null,
    }))
    .filter((i) => i.balance > 0.005);

  const { data: depRows } = await supabase
    .from('client_deposits')
    .select('type, amount, transaction_date, notes')
    .eq('client_name', clientName)
    .order('transaction_date', { ascending: true });
  const deposits = (depRows ?? []).map((d) => ({
    type: d.type as string,
    amount: Number(d.amount),
    date: d.transaction_date as string,
    notes: (d.notes as string) ?? '',
  }));

  const receivables = clientRow?.receivables == null ? null : Number(clientRow.receivables);
  const receivablesAsOf = clientRow?.receivables_as_of ?? null;
  const balanceInvoices: BalanceInvoice[] = invoices.map((i) => ({
    billingMonth: i.billingMonth,
    balance: i.balance,
    sentDate: i.sentDate,
    createdDate: i.createdDate,
  }));
  const currentBalance = runningBalance({ receivables, receivablesAsOf, invoices: balanceInvoices });
  const statement = buildClientStatement({ currentBalance, receivables, receivablesAsOf, invoices, deposits });

  return { statement, found: !!clientRow || invoices.length > 0 };
}
