import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { setInvoiceBilledFlags } from '@/lib/billing/persist-invoice';
import { sendClientMail, loadEmailBrand } from '@/lib/email';
import { buildInvoiceAttachments, invoiceDocPaths } from '@/lib/finance/invoice-attachments';
import { applyDepositToInvoice, checkDepositAutoSettle } from '@/lib/finance/deposit-apply';
import { resolvePartnerCc, mergeCcAddresses } from '@/lib/finance/invoice-cc';
import { loadOutboundIdentity, mailboxNotConfigured } from '@/lib/firm/outbound-identity';
import { renderBillingEmail } from '@/lib/billing/email-blocks';
import { loadEmailWording } from '@/lib/billing/wording-store';

interface InvoiceRow {
  id: number;
  invoice_number: string;
  client_id: string | null;
  client_name: string;
  matter_name: string | null;
  matter_id: string | null;
  billing_month: string;
  total_amount: number;
  total_expenses: number;
  paid_amount: number;
  signed_pdf_path: string | null;
  signed_breakdown_pdf_path: string | null;
  pdf_storage_path: string | null;
  breakdown_pdf_storage_path: string | null;
  billing_settings: Record<string, unknown> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  line_items: any[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expense_items: any[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fee_lines: any[] | null;
}

function parseCcList(raw: unknown): { address: string }[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw
    .split(/[;,]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    .map((address) => ({ address }));
}

/**
 * POST /api/finance/batch-send
 * Send billing invoices to clients via email from the firm's billing mailbox.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { invoiceIds, ccRelationshipPartner, ccManagingPartner } = await req.json();
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return NextResponse.json({ error: 'invoiceIds required' }, { status: 400 });
  }
  const ccOptions = {
    relationshipPartner: ccRelationshipPartner === true,
    managingPartner: ccManagingPartner === true,
  };

  const supabase = getServiceDbForFirm(session.firmId);

  const identity = await loadOutboundIdentity(session.firmId);
  if (!identity.financeAddress) {
    return NextResponse.json(
      { error: mailboxNotConfigured('billing mailbox (settings.email.financeAddress)') },
      { status: 400 },
    );
  }

  // Fetch invoices
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, client_id, client_name, matter_name, matter_id, billing_month, total_amount, total_expenses, paid_amount, signed_pdf_path, signed_breakdown_pdf_path, pdf_storage_path, breakdown_pdf_storage_path, billing_settings, line_items, expense_items, fee_lines')
    .in('id', invoiceIds);

  if (!invoices || invoices.length === 0) {
    return NextResponse.json({ error: 'No invoices found' }, { status: 404 });
  }

  // Look up client contact emails (fallback when the invoice's billing_settings
  // doesn't override).
  const clientNames = [...new Set((invoices as InvoiceRow[]).map((i) => i.client_name))];
  const { data: clients } = await supabase
    .from('clients')
    .select('name, contact_email')
    .in('name', clientNames);

  const clientEmailMap = new Map(
    (clients ?? []).map((c: { name: string; contact_email: string | null }) => [c.name, c.contact_email])
  );

  const [wording, brand] = await Promise.all([loadEmailWording(supabase), loadEmailBrand(session.firmId)]);

  // Partners finance asked to copy. Resolved up front for the whole batch so a
  // single client/team lookup covers every invoice.
  const partnerCc = await resolvePartnerCc(supabase, session.firmId, invoices as InvoiceRow[], ccOptions);

  // Send emails
  const results = await Promise.allSettled(
    (invoices as InvoiceRow[]).map(async (inv) => {
      const settings = (inv.billing_settings ?? {}) as Record<string, unknown>;
      const overrideEmail = typeof settings.clientEmail === 'string' ? settings.clientEmail.trim() : '';
      const clientEmail = overrideEmail || clientEmailMap.get(inv.client_name);
      if (!clientEmail) throw new Error(`No email for client: ${inv.client_name}`);
      const ccList = mergeCcAddresses(
        parseCcList(settings.ccEmails),
        partnerCc.byInvoice.get(inv.id) ?? [],
        clientEmail,
      );

      // Send the billing letter PDF + breakdown PDF (each prefers a signed
      // upload, falling back to the auto-generated PDF). A missing letter means
      // the invoice was never generated — don't send an empty statement.
      if (!invoiceDocPaths(inv).letter) {
        throw new Error(`No PDF available for invoice ${inv.invoice_number}. Generate the invoice first.`);
      }

      // Settle-from-deposit invoices auto-apply their frozen depositApplied on
      // send. Validate BEFORE emailing: if the live deposit no longer covers
      // the printed figure, the letter would promise a settlement the books
      // can't honor — block this send.
      const autoSettle = await checkDepositAutoSettle(supabase, inv);
      if (autoSettle.status === 'blocked') {
        throw new Error(`${inv.invoice_number}: ${autoSettle.error}`);
      }

      const attachments = await buildInvoiceAttachments(supabase, inv);

      // One billing email for every client, in the wording finance keeps on the
      // Billing Letter page; which paragraphs it carries follows the invoice.
      const { subject, html: bodyHtml } = renderBillingEmail(inv, { paragraphs: wording.paragraphs, subject: wording.subject, brand });

      await sendClientMail({
        firmId: session.firmId,
        fromAddress: identity.financeAddress,
        fromName: identity.firmName,
        subject,
        bodyHtml,
        to: [{ address: clientEmail }],
        cc: ccList.length > 0 ? ccList : undefined,
        attachments,
      });

      // Update invoice status → sent, and mark its entries billed (the flags
      // reflect "on a SENT invoice").
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      await supabase
        .from('invoices')
        .update({ status: 'sent', sent_date: today, updated_at: new Date().toISOString() })
        .eq('id', inv.id);
      await setInvoiceBilledFlags(supabase, inv, true);

      const warnings = (partnerCc.notes.get(inv.id) ?? []).map(
        (note) => `${inv.invoice_number}: ${note.message} It was sent without that copy.`
      );

      // Draw down the deposit now that the invoice is out. A failure here must
      // not report the send itself as failed (the email is gone) — surface it
      // as a warning so finance applies the deposit manually.
      if (autoSettle.status === 'ready') {
        const applied = await applyDepositToInvoice(supabase, session.firmId, inv, autoSettle.amount, {
          recordedBy: session.user.name ?? session.user.email ?? 'system',
          notes: 'Auto-applied on send (settle from deposit)',
        });
        if (!applied.ok) {
          console.error(`[batch-send] auto-settle failed for ${inv.invoice_number}:`, applied.error);
          warnings.push(`${inv.invoice_number} was sent, but the deposit application failed (${applied.error}). Apply the deposit manually from the receivables page.`);
        }
      }

      return { invoiceId: inv.id, status: 'sent', warnings };
    })
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason?.message ?? 'Unknown error');
  const warnings = [...new Set(
    results
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => (r as PromiseFulfilledResult<{ warnings: string[] }>).value.warnings)
  )];

  return NextResponse.json({ sent, failed, warnings, total: invoiceIds.length });
}
