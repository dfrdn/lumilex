import { invoicePeriodDisplay } from '@/lib/billing/letter-format';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { invoiceOpenBalance } from '@/lib/finance/invoice-amounts';
import { sendClientMail } from '@/lib/email';
import { buildInvoiceAttachments } from '@/lib/finance/invoice-attachments';
import { resolvePartnerCc, mergeCcAddresses } from '@/lib/finance/invoice-cc';
import { loadOutboundIdentity, mailboxNotConfigured, signOff } from '@/lib/firm/outbound-identity';

const TEMPLATES = {
  reminder: (inv: InvInfo, firmName: string) => ({
    subject: `Reminder: Billing Statement – ${inv.monthDisplay} | ${inv.clientName}`,
    body: `
      <div style="font-family: 'Adobe Garamond Pro', Garamond, 'Times New Roman', serif; font-size: 14px; color: #333;">
        <p>Good day,</p>
        <p>This is a gentle reminder that your billing statement for <strong>${inv.monthDisplay}</strong> in the amount of <strong>${inv.formatted}</strong> is due${inv.dueDate ? ` on <strong>${inv.dueDate}</strong>` : ''}.</p>
        <p>Kindly disregard this reminder if payment has already been made. Please find the original billing statement attached for your reference.</p>
        <br/>
        ${signOff(firmName, 'Finance Department')}
      </div>
    `.trim(),
  }),
  overdue: (inv: InvInfo, firmName: string) => ({
    subject: `Overdue: Billing Statement – ${inv.monthDisplay} | ${inv.clientName}`,
    body: `
      <div style="font-family: 'Adobe Garamond Pro', Garamond, 'Times New Roman', serif; font-size: 14px; color: #333;">
        <p>Good day,</p>
        <p>Your billing statement for <strong>${inv.monthDisplay}</strong> amounting to <strong>${inv.formatted}</strong> is now <strong>${inv.daysOverdue} days overdue</strong>.</p>
        <p>We kindly request your prompt attention to this matter. Please find the billing statement attached for your reference.</p>
        <br/>
        ${signOff(firmName, 'Finance Department')}
      </div>
    `.trim(),
  }),
  final: (inv: InvInfo, firmName: string) => ({
    subject: `Final Notice: Outstanding Balance – ${inv.monthDisplay} | ${inv.clientName}`,
    body: `
      <div style="font-family: 'Adobe Garamond Pro', Garamond, 'Times New Roman', serif; font-size: 14px; color: #333;">
        <p>Good day,</p>
        <p>This is a <strong>final notice</strong> regarding your outstanding balance of <strong>${inv.formatted}</strong> for the billing period of <strong>${inv.monthDisplay}</strong>, which is now <strong>${inv.daysOverdue} days overdue</strong>.</p>
        <p>We urge your immediate attention to this matter. Please find the billing statement attached.</p>
        <br/>
        ${signOff(firmName, 'Finance Department')}
      </div>
    `.trim(),
  }),
};

interface InvInfo {
  clientName: string;
  monthDisplay: string;
  formatted: string;
  dueDate: string | null;
  daysOverdue: number;
}

/**
 * POST /api/finance/send-followup
 * Send follow-up emails for aging receivables.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { invoiceIds, template, customSubject, customBody, ccRelationshipPartner, ccManagingPartner } = await req.json();
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return NextResponse.json({ error: 'invoiceIds required' }, { status: 400 });
  }
  const ccOptions = {
    relationshipPartner: ccRelationshipPartner === true,
    managingPartner: ccManagingPartner === true,
  };
  if (!template || !['reminder', 'overdue', 'final'].includes(template)) {
    return NextResponse.json({ error: 'template must be reminder, overdue, or final' }, { status: 400 });
  }

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
    .select('id, invoice_number, client_id, client_name, billing_month, total_amount, total_expenses, paid_amount, sent_date, due_date, pdf_storage_path, signed_pdf_path, breakdown_pdf_storage_path, signed_breakdown_pdf_path, billing_settings')
    .in('id', invoiceIds);

  if (!invoices || invoices.length === 0) {
    return NextResponse.json({ error: 'No invoices found' }, { status: 404 });
  }

  // Client emails
  const clientNames = [...new Set((invoices as { client_name: string }[]).map((i) => i.client_name))];
  const { data: clients } = await supabase
    .from('clients')
    .select('name, contact_email')
    .in('name', clientNames);
  const clientEmailMap = new Map(
    (clients ?? []).map((c: { name: string; contact_email: string | null }) => [c.name, c.contact_email])
  );

  // Partners finance asked to copy. Resolved up front for the whole batch so a
  // single client/team lookup covers every invoice.
  const partnerCc = await resolvePartnerCc(
    supabase,
    session.firmId,
    invoices as { id: number; client_id: string | null; client_name: string }[],
    ccOptions,
  );

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  const results = await Promise.allSettled(
    (invoices as {
      id: number; invoice_number: string; client_id: string | null; client_name: string; billing_month: string;
      total_amount: number; total_expenses: number; paid_amount: number;
      sent_date: string | null; due_date: string | null;
      pdf_storage_path: string | null; signed_pdf_path: string | null;
      breakdown_pdf_storage_path: string | null; signed_breakdown_pdf_path: string | null;
      billing_settings: { includeVAT?: boolean | string | null } | null;
    }[]).map(async (inv) => {
      const clientEmail = clientEmailMap.get(inv.client_name);
      if (!clientEmail) throw new Error(`No email for client: ${inv.client_name}`);

      // VAT-inclusive — the notice must state the gross amount the client owes.
      const balance = invoiceOpenBalance(inv);
      const formatted = `₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
      const monthDisplay = invoicePeriodDisplay(inv);

      const refDate = inv.sent_date ?? inv.due_date ?? todayStr;
      const daysOverdue = Math.max(0, Math.floor((today.getTime() - new Date(refDate + 'T00:00:00').getTime()) / 86400000));

      let subject: string;
      let body: string;

      if (customSubject && customBody) {
        const vars: Record<string, string> = {
          clientName: inv.client_name,
          month: monthDisplay,
          amount: formatted,
          invoiceNumber: inv.invoice_number,
          dueDate: inv.due_date ?? '',
          daysOverdue: String(daysOverdue),
          firmName: identity.firmName,
        };
        subject = customSubject.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => vars[key] ?? `{{${key}}}`);
        body = `<div style="font-family: 'Adobe Garamond Pro', Garamond, 'Times New Roman', serif; font-size: 14px; color: #333;">${
          customBody.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => vars[key] ?? `{{${key}}}`)
        }</div>`;
      } else {
        const templateFn = TEMPLATES[template as keyof typeof TEMPLATES];
        const result = templateFn({
          clientName: inv.client_name,
          monthDisplay,
          formatted,
          dueDate: inv.due_date,
          daysOverdue,
        }, identity.firmName);
        subject = result.subject;
        body = result.body;
      }

      // Re-attach the billing letter + breakdown PDFs (signed upload preferred,
      // else the auto-generated PDF) so the reminder actually carries the statement.
      const attachments = await buildInvoiceAttachments(supabase, inv);

      const ccList = mergeCcAddresses([], partnerCc.byInvoice.get(inv.id) ?? [], clientEmail);

      await sendClientMail({
        firmId: session.firmId,
        fromAddress: identity.financeAddress,
        fromName: identity.firmName,
        subject,
        bodyHtml: body,
        to: [{ address: clientEmail }],
        cc: ccList.length > 0 ? ccList : undefined,
        attachments,
        importance: template === 'final' ? 'high' : 'normal',
      });

      const warnings = (partnerCc.notes.get(inv.id) ?? []).map(
        (note) => `${inv.invoice_number}: ${note.message} It was sent without that copy.`
      );

      return { invoiceId: inv.id, sent: true, warnings };
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
