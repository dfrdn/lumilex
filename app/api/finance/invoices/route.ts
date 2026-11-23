import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { applyInvoicePayment, recomputeInvoicePaid } from '@/lib/finance/apply-invoice-payment';
import { setInvoiceBilledFlags } from '@/lib/billing/persist-invoice';
import { invoiceOpenBalance } from '@/lib/finance/invoice-amounts';
import { applyDepositToInvoice, checkDepositAutoSettle } from '@/lib/finance/deposit-apply';
import { getRelationshipPartnersForClients, clientRefKey } from '@/lib/auth/relationship-partner';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get('month');
  const status = req.nextUrl.searchParams.get('status');

  const supabase = getServiceDbForFirm(session.firmId);
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 200), 500);
  let query = supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month must be in YYYY-MM format' }, { status: 400 });
    }
    query = query.eq('billing_month', month);
  }
  if (status) {
    const validStatuses = ['draft', 'sent', 'partial', 'paid'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be: ${validStatuses.join(', ')}` }, { status: 400 });
    }
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[finance-invoices]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Attach the client's relationship partner so finance can see, from the list,
  // who has to clear the bundle and who a send would copy.
  const rows = (data ?? []) as { client_id: string | null; client_name: string }[];
  const partners = await getRelationshipPartnersForClients(rows, session.firmId);
  const invoices = rows.map((row) => {
    const rp = partners.get(clientRefKey(row)) ?? null;
    return {
      ...row,
      relationship_partner: rp ? { name: rp.name, active: rp.active } : null,
    };
  });

  return NextResponse.json({ invoices });
}

/** PATCH - Update invoice status or record payment */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { invoiceId, action } = body;

  if (!invoiceId) {
    return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  // ── Record Payment ────────────────────────────────────────────
  if (action === 'record_payment') {
    const { amount, paymentDate, paymentMethod, referenceNumber, notes } = body;
    if (!amount || !paymentDate) {
      return NextResponse.json({ error: 'amount and paymentDate required' }, { status: 400 });
    }

    const result = await applyInvoicePayment(supabase, session.firmId, invoiceId, parseFloat(amount), {
      paymentDate,
      paymentMethod: paymentMethod ?? 'bank_transfer',
      referenceNumber: referenceNumber ?? '',
      notes: notes ?? '',
      recordedBy: session.user.name ?? session.user.email ?? 'unknown',
    });

    if (!result.ok) {
      console.error('[finance-invoices] payment:', result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // A payment moves the invoice to partial/paid (non-draft), so its entries
    // are now billed. Sync the billed/reimbursed/invoiced flags.
    const { data: snap } = await supabase
      .from('invoices')
      .select('line_items, expense_items, fee_lines')
      .eq('id', invoiceId)
      .maybeSingle();
    if (snap) await setInvoiceBilledFlags(supabase, snap, true);

    return NextResponse.json({ success: true });
  }

  // ── Record Credit / Discount (post-send) ─────────────────────
  // A discount granted AFTER an invoice is sent. Stored as an invoice_payments
  // row with method 'credit' so it settles part of the receivable through the
  // existing paid_amount math (reduces the open balance on every AR surface and
  // is reversible) WITHOUT being counted as collected cash (cash-flow excludes
  // method 'credit').
  if (action === 'record_credit') {
    const { amount, creditDate, reason } = body as { amount?: unknown; creditDate?: string; reason?: string };
    const amt = Math.round(parseFloat(String(amount)) * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }
    const dateRe = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    if (!creditDate || !dateRe.test(creditDate)) {
      return NextResponse.json({ error: 'creditDate must be YYYY-MM-DD' }, { status: 400 });
    }

    const { data: inv } = await supabase
      .from('invoices')
      .select('id, status, total_amount, total_expenses, paid_amount, billing_settings')
      .eq('id', invoiceId)
      .maybeSingle();
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    if (inv.status === 'draft') {
      return NextResponse.json(
        { error: 'Credits apply to sent invoices. Adjust a draft by regenerating it with a discount instead.' },
        { status: 409 },
      );
    }
    const open = invoiceOpenBalance(inv);
    if (amt > open + 0.01) {
      return NextResponse.json(
        { error: `Credit (₱${amt.toLocaleString()}) exceeds the outstanding balance (₱${open.toLocaleString()}).` },
        { status: 400 },
      );
    }

    const { error: insErr } = await supabase.from('invoice_payments').insert({
      invoice_id: invoiceId,
      amount: amt,
      payment_date: creditDate,
      payment_method: 'credit',
      reference_number: '',
      notes: typeof reason === 'string' ? reason : '',
      recorded_by: session.user.name ?? session.user.email ?? 'unknown',
    });
    if (insErr) {
      console.error('[finance-invoices] record_credit:', insErr.message);
      return NextResponse.json({ error: 'Failed to record credit' }, { status: 500 });
    }
    // Roll paid_amount + status forward from all invoice_payments (credit included).
    await recomputeInvoicePaid(supabase, session.firmId, invoiceId);
    return NextResponse.json({ success: true });
  }

  // ── Reverse a previously recorded credit ─────────────────────
  if (action === 'reverse_credit') {
    const cid = Number((body as { creditId?: unknown }).creditId);
    if (!Number.isFinite(cid)) {
      return NextResponse.json({ error: 'creditId is required' }, { status: 400 });
    }
    const { data: row } = await supabase
      .from('invoice_payments')
      .select('id, invoice_id, payment_method')
      .eq('id', cid)
      .maybeSingle();
    if (!row || row.invoice_id !== Number(invoiceId) || row.payment_method !== 'credit') {
      return NextResponse.json({ error: 'Credit not found on this invoice' }, { status: 404 });
    }
    const { error: delErr } = await supabase.from('invoice_payments').delete().eq('id', cid);
    if (delErr) {
      console.error('[finance-invoices] reverse_credit:', delErr.message);
      return NextResponse.json({ error: 'Failed to reverse credit' }, { status: 500 });
    }
    await recomputeInvoicePaid(supabase, session.firmId, invoiceId);
    return NextResponse.json({ success: true });
  }

  // ── Update Dates (manual sent_date / due_date override) ───────
  // sent_date is normally stamped automatically when an invoice is sent;
  // this lets finance correct it (e.g. the invoice actually went out earlier)
  // so the receivables aging clock reflects reality.
  if (action === 'update_dates') {
    const { sent_date, due_date } = body as { sent_date?: string | null; due_date?: string | null };
    const dateRe = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (sent_date !== undefined) {
      if (sent_date !== null) {
        if (!dateRe.test(sent_date)) {
          return NextResponse.json({ error: 'sent_date must be YYYY-MM-DD' }, { status: 400 });
        }
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
        if (sent_date > today) {
          return NextResponse.json({ error: 'sent_date cannot be in the future' }, { status: 400 });
        }
      }
      updateData.sent_date = sent_date;
    }

    if (due_date !== undefined) {
      if (due_date !== null && !dateRe.test(due_date)) {
        return NextResponse.json({ error: 'due_date must be YYYY-MM-DD' }, { status: 400 });
      }
      updateData.due_date = due_date;
    }

    const { data, error } = await supabase
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId)
      .select('id, sent_date, due_date')
      .single();

    if (error) {
      console.error('[finance-invoices] update_dates:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ success: true, invoice: data });
  }

  // ── Update Status ─────────────────────────────────────────────
  const { status } = body;
  if (!status) {
    return NextResponse.json({ error: 'status is required' }, { status: 400 });
  }

  const validStatuses = ['draft', 'sent', 'partial', 'paid'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `Status must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
  }

  // Manually marking a settle-from-deposit invoice as sent auto-applies its
  // frozen deposit figure, same as the email send. Check up front so a stale
  // figure blocks the flip instead of leaving the books behind the letter.
  const { data: fullInv } = await supabase
    .from('invoices')
    .select('id, client_id, client_name, invoice_number, total_amount, total_expenses, paid_amount, billing_settings, line_items, expense_items, fee_lines')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!fullInv) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  const autoSettle = status === 'sent'
    ? await checkDepositAutoSettle(supabase, fullInv)
    : null;
  if (autoSettle?.status === 'blocked') {
    return NextResponse.json({ error: autoSettle.error }, { status: 409 });
  }

  const updateData: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === 'sent') {
    updateData.sent_date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  }

  const { error } = await supabase
    .from('invoices')
    .update(updateData)
    .eq('id', invoiceId);

  if (error) {
    console.error('[finance-invoices]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Billed/reimbursed/invoiced flags reflect "on a SENT invoice": flip them on
  // for any non-draft status, off when reverting to draft. The invoice's stored
  // snapshot tells us which entries belong to it.
  await setInvoiceBilledFlags(supabase, fullInv, status !== 'draft');

  let warning: string | undefined;
  if (autoSettle?.status === 'ready') {
    const applied = await applyDepositToInvoice(supabase, session.firmId, fullInv, autoSettle.amount, {
      recordedBy: session.user.name ?? session.user.email ?? 'unknown',
      notes: 'Auto-applied on send (settle from deposit)',
    });
    if (!applied.ok) {
      console.error(`[finance-invoices] auto-settle failed for invoice ${invoiceId}:`, applied.error);
      warning = `Marked sent, but the deposit application failed (${applied.error}). Apply the deposit manually.`;
    }
  }

  return NextResponse.json({ success: true, warning });
}

/**
 * DELETE /api/finance/invoices?id=X
 * Deletes a draft invoice: removes storage files, reverses billed/reimbursed
 * flags so the underlying DTRs and expenses become available for re-billing,
 * then drops the invoice row. Sent/partial/paid invoices cannot be deleted.
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
  const invoiceId = idParam ? parseInt(idParam) : NaN;
  if (!Number.isFinite(invoiceId)) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  const { data: invoice, error: fetchErr } = await supabase
    .from('invoices')
    .select('id, status, line_items, expense_items, docx_storage_path, xlsx_storage_path, pdf_storage_path, breakdown_pdf_storage_path')
    .eq('id', invoiceId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[finance-invoices DELETE]', fetchErr.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  if (invoice.status !== 'draft') {
    return NextResponse.json(
      { error: `Only draft invoices can be deleted. This invoice is "${invoice.status}".` },
      { status: 409 },
    );
  }

  // Reverse DTR billed flags
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dtrIds = (invoice.line_items ?? []).flatMap((l: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l.entries ?? []).map((e: any) => e.rawDtrId ?? e.id),
  ).filter(Boolean);
  if (dtrIds.length > 0) {
    const { error } = await supabase
      .from('dtr')
      .update({ billed: false })
      .in('notion_id', dtrIds);
    if (error) console.error('[finance-invoices DELETE] DTR unflag:', error.message);
  }

  // Reverse reimbursement flags
  const reimbIds = (invoice.expense_items ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.source === 'reimbursement' || !e.source)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => e.id)
    .filter((id: string) => id && !String(id).startsWith('mexp-'));
  if (reimbIds.length > 0) {
    const { error } = await supabase
      .from('reimbursements')
      .update({ billed: false, invoice_id: null })
      .in('notion_id', reimbIds);
    if (error) console.error('[finance-invoices DELETE] reimbursement unflag:', error.message);
  }

  // Reverse matter_expense flags
  const mexpIds = (invoice.expense_items ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.source === 'finance' || (e.id && String(e.id).startsWith('mexp-')))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => parseInt(String(e.id).replace('mexp-', '')))
    .filter((id: number) => !isNaN(id));
  if (mexpIds.length > 0) {
    const { error } = await supabase
      .from('matter_expenses')
      .update({ billed: false, invoice_id: null })
      .in('id', mexpIds);
    if (error) console.error('[finance-invoices DELETE] matter_expense unflag:', error.message);
  }

  // Delete storage files (best-effort)
  const filesToRemove = [
    invoice.docx_storage_path,
    invoice.xlsx_storage_path,
    invoice.pdf_storage_path,
    invoice.breakdown_pdf_storage_path,
  ].filter(Boolean) as string[];
  if (filesToRemove.length > 0) {
    const { error } = await supabase.storage.from('files').remove(filesToRemove);
    if (error) console.error('[finance-invoices DELETE] storage cleanup:', error.message);
  }

  // Delete any payments rows on this invoice (FK cleanup)
  await supabase.from('invoice_payments').delete().eq('invoice_id', invoiceId);

  const { error: delErr } = await supabase.from('invoices').delete().eq('id', invoiceId);
  if (delErr) {
    console.error('[finance-invoices DELETE]', delErr.message);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
