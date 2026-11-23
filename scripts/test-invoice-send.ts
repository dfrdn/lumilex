/**
 * Controlled invoice-send test. Exercises the EXACT production send path
 * (app/api/finance/batch-send/route.ts → lib/email.ts sendClientMail) for a
 * single real invoice, but delivers to an address you name instead of the
 * client. Does NOT change invoice status or any billed flags.
 *
 * Run: npx tsx scripts/test-invoice-send.ts <RECIPIENT> [INVOICE_NUMBER]
 *   INVOICE_NUMBER defaults to the first draft that has a PDF.
 *
 * The recipient is required and the sending firm is read off the invoice — a
 * default recipient and a hardcoded sending mailbox are how this script used to
 * carry one tenant's addresses.
 */
import './load-env';
import './probe-websocket';
import { getSupabase } from '@/lib/supabase';
import { sendClientMail } from '@/lib/email';
import { loadOutboundIdentity } from '@/lib/firm/outbound-identity';
import { invoiceGrossDue } from '@/lib/finance/invoice-amounts';
import { buildInvoiceAttachments, invoiceDocPaths } from '@/lib/finance/invoice-attachments';

const recipient = process.argv[2];
const invoiceNumberArg = process.argv[3];

async function main() {
  if (!recipient || !recipient.includes('@')) {
    throw new Error('Usage: npx tsx scripts/test-invoice-send.ts <RECIPIENT> [INVOICE_NUMBER]');
  }

  const supabase = getSupabase();

  let q = supabase
    .from('invoices')
    .select('id, firm_id, invoice_number, client_name, billing_month, total_amount, total_expenses, signed_pdf_path, signed_breakdown_pdf_path, pdf_storage_path, breakdown_pdf_storage_path')
    .limit(1);
  q = invoiceNumberArg
    ? q.eq('invoice_number', invoiceNumberArg)
    : q.eq('status', 'draft').not('pdf_storage_path', 'is', null).order('invoice_number');
  const { data: rows } = await q;
  const inv = rows?.[0];
  if (!inv) throw new Error('No matching invoice found');

  if (!invoiceDocPaths(inv).letter) throw new Error(`No PDF for ${inv.invoice_number} — generate it first`);

  // The exact production identity: the invoice's own firm, its own billing box.
  const identity = await loadOutboundIdentity(inv.firm_id);
  if (!identity.financeAddress) {
    throw new Error(`Firm ${inv.firm_id} has no settings.email.financeAddress configured`);
  }

  console.log(`\nInvoice:   ${inv.invoice_number}  (${inv.client_name}, ${inv.billing_month})`);
  console.log(`From:      ${identity.firmName} <${identity.financeAddress}>`);
  console.log(`To:        ${recipient}`);

  // Exact production attachment set: billing letter PDF + breakdown PDF.
  const attachments = await buildInvoiceAttachments(supabase, inv);
  attachments.forEach((a) =>
    console.log(`  attached ${a.name} (${(Buffer.byteLength(a.contentBytes, 'base64') / 1024).toFixed(0)} KB)`));
  const totalBytes = attachments.reduce((s, a) => s + Buffer.byteLength(a.contentBytes, 'base64'), 0);
  console.log(`  total attachment size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  const [year, mon] = inv.billing_month.split('-');
  const monthDisplay = new Date(parseInt(year), parseInt(mon) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const total = invoiceGrossDue(inv);
  const formatted = `₱${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  const bodyHtml = `
    <div style="font-family: 'Adobe Garamond Pro', Garamond, 'Times New Roman', serif; font-size: 14px; color: #333;">
      <p><strong>[TEST SEND — please ignore]</strong></p>
      <p>Good day,</p>
      <p>Please find attached our billing statement for <strong>${monthDisplay}</strong> in the amount of <strong>${formatted}</strong>.</p>
      <p>Should you have any questions, please do not hesitate to contact us.</p>
      <br/>
      <p>Best regards,<br/><strong>${identity.firmName}</strong><br/>Finance Department</p>
    </div>`.trim();

  console.log('\nSending through Resend …');
  await sendClientMail({
    firmId: inv.firm_id,
    fromAddress: identity.financeAddress,
    fromName: identity.firmName,
    subject: `[TEST] Billing Statement – ${monthDisplay} | ${inv.client_name}`,
    bodyHtml,
    to: [{ address: recipient }],
    attachments,
  });
  console.log('✅ Resend accepted the message. Check the inbox + spam folder.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\n❌ SEND FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
