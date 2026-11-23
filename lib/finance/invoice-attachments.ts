import type { SupabaseClient } from '@supabase/supabase-js';

/** Storage-path fields an invoice row needs for building email attachments. */
export interface InvoiceDocPaths {
  invoice_number: string;
  pdf_storage_path: string | null;
  signed_pdf_path: string | null;
  breakdown_pdf_storage_path: string | null;
  signed_breakdown_pdf_path: string | null;
}

export interface MailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64
}

/** The two PDF paths an invoice email sends: billing letter + breakdown. */
export function invoiceDocPaths(inv: InvoiceDocPaths): { letter: string | null; breakdown: string | null } {
  return {
    letter: inv.signed_pdf_path ?? inv.pdf_storage_path,
    breakdown: inv.signed_breakdown_pdf_path ?? inv.breakdown_pdf_storage_path,
  };
}

/**
 * Build the attachment set for an invoice email: the billing letter PDF and the
 * breakdown PDF. Each prefers the manually-signed upload, falling back to the
 * auto-generated PDF. Missing files are skipped. No XLSX — clients get PDFs only.
 */
export async function buildInvoiceAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  inv: InvoiceDocPaths,
): Promise<MailAttachment[]> {
  const { letter, breakdown } = invoiceDocPaths(inv);
  const attachments: MailAttachment[] = [];

  const add = async (path: string | null, name: string) => {
    if (!path) return;
    const { data } = await supabase.storage.from('files').download(path);
    if (!data) return;
    attachments.push({
      name,
      contentType: 'application/pdf',
      contentBytes: Buffer.from(await data.arrayBuffer()).toString('base64'),
    });
  };

  await add(letter, `${inv.invoice_number} - Billing Letter.pdf`);
  await add(breakdown, `${inv.invoice_number} - Breakdown.pdf`);

  return attachments;
}
