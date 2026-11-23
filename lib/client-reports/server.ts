import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { buildLetterBody, type LetterParagraph } from '@/lib/docx/letter-body';
import { placeOnLetterhead } from '@/lib/docx/on-letterhead';
import { convertDocxToPdf } from '@/lib/microsoft-graph';
import { isFeatureAvailable } from '@/lib/firm/features';
import { loadOutboundIdentity } from '@/lib/firm/outbound-identity';
import { findFirmInvoiceSettings } from '@/lib/billing/firm-defaults';
import type { ReportEmailFirm } from './letter';

/**
 * The server side every client report shares, whatever it is about — a mark,
 * a company: the letter on the firm's own letterhead, the PDF where the firm
 * converts Word files, a letter edited in Word, the annexes read for the
 * email, and the firm block under the sender's name. What the report is about
 * is the caller's. Every read goes through the firm's own scoped client.
 */

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A report's letter on the firm's letterhead. It is advice to the client, so it is marked privileged. */
export function reportDocx(firmId: string, paragraphs: LetterParagraph[]): Promise<Buffer> {
  const marking = { text: '**PRIVILEGED AND CONFIDENTIAL**', alignment: 'right' as const, spacing_after: 240 };
  return placeOnLetterhead(firmId, (parts) => buildLetterBody([marking, ...paragraphs], parts));
}

/** A stem for a report's file name: letters, digits, dots, dashes and underscores. */
export const safeFileStem = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

/** An annex's file name in the email: "Annex B - specimen.pdf". */
export const annexFileName = (a: { label: string; name: string }) => `Annex ${a.label} - ${a.name}`;

/** An edited letter comes in the request body, which the host caps at 4.5 MB once encoded. */
const MAX_EDITED_BYTES = 3 * 1024 * 1024;

/** The person's edited Word letter, or why it can't be used. */
export function readEditedLetter(edited: { name: string; base64: string }): { name: string; docx: Buffer } | { error: string } {
  const docx = Buffer.from(edited.base64, 'base64');
  if (docx.length > MAX_EDITED_BYTES || docx.subarray(0, 2).toString('latin1') !== 'PK' || !/\.docx$/i.test(edited.name)) {
    return { error: 'The edited letter must be a Word (.docx) file of at most 3 MB.' };
  }
  return { name: edited.name.replace(/[^\w.\- ]+/g, '_'), docx };
}

/**
 * The letter as the client gets it, as a PDF — converted once through
 * Microsoft Graph, which is the firm's `docx_pdf` integration. Null for a firm
 * without it: the letter then goes as the Word file. A firm that has the
 * feature and still can't reach Graph is a misconfiguration and throws.
 */
export async function reportPdf(firmId: string, docx: Buffer, docxName: string): Promise<Buffer | null> {
  if (!(await isFeatureAvailable(firmId, 'docx_pdf'))) return null;
  return convertDocxToPdf(firmId, docx, docxName.replace(/\.docx$/i, '') + '.docx');
}

/** Whether this firm's reports can go as a PDF (see reportPdf). */
export function reportsGoAsPdf(firmId: string): Promise<boolean> {
  return isFeatureAvailable(firmId, 'docx_pdf');
}

/** The letter file that goes out: the PDF when there is one, else the Word file. */
export function letterFile(docx: Buffer, docxName: string, pdf: Buffer | null): { filename: string; content: Buffer; type: string } {
  return pdf
    ? { filename: docxName.replace(/\.docx$/i, '') + '.pdf', content: pdf, type: 'application/pdf' }
    : { filename: docxName, content: docx, type: DOCX_TYPE };
}

/** An attachment's content type, from its name. */
export function attachmentType(filename: string): string {
  const name = filename.toLowerCase();
  if (name.endsWith('.docx')) return DOCX_TYPE;
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

/** The firm block under the sender's name in the covering email: its own name and address. */
export async function loadReportEmailFirm(firmId: string): Promise<ReportEmailFirm> {
  const [identity, invoice] = await Promise.all([loadOutboundIdentity(firmId), findFirmInvoiceSettings(firmId)]);
  const addressLines = [invoice?.firmAddress ?? '', invoice?.firmAddress2 ?? '']
    .flatMap((b) => b.split('\n')).map((l) => l.trim()).filter(Boolean);
  return { name: identity.firmName, addressLines };
}

/** Resend takes a message up to 40 MB; this leaves room for the body and the encoding, as the app's other Resend mail does. */
export const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;
export const TOO_LARGE = 'The report and its annexes are over 35 MB, too large to email. Leave out an annex and share it by link.';

/**
 * The letter and its annexes as email attachments, or why they can't go.
 * Checked first from the recorded sizes, so a pile of large annexes isn't
 * read only to be refused; then read one at a time, since each storage read
 * holds a pooler connection. The annexes' paths come from the firm's own rows.
 */
export async function reportAttachments(
  firmId: string,
  letter: { filename: string; content: Buffer },
  annexes: { label: string; name: string; storagePath: string; sizeBytes: number | null }[],
): Promise<{ attachments: { filename: string; content: Buffer }[] } | { error: string; status: number }> {
  const recorded = annexes.reduce((n, a) => n + (a.sizeBytes ?? 0), letter.content.length);
  if (recorded > MAX_ATTACHMENT_BYTES) return { error: TOO_LARGE, status: 413 };
  const service = getServiceDbForFirm(firmId);
  const attachments = [letter];
  let total = letter.content.length;
  for (const annex of annexes) {
    const { data, error } = await service.storage.from('files').download(annex.storagePath);
    if (error || !data) return { error: `Could not read ${annex.name}`, status: 500 };
    const buf = Buffer.from(await data.arrayBuffer());
    total += buf.length;
    attachments.push({ filename: annexFileName(annex), content: buf });
  }
  if (total > MAX_ATTACHMENT_BYTES) return { error: TOO_LARGE, status: 413 };
  return { attachments };
}
