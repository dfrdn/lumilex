import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument, StandardFonts, rgb } from 'pdf-lib';
import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';
import { formatManila } from '../../lib/dates';
import { FIRM, type DocLayout } from './dataset';

/**
 * Renders the demo's generated documents — pleadings, letters, memoranda,
 * agreements, certificates, court records and receipts — to PDF (pdfkit, the
 * core Times faces, nothing embedded) and working drafts to DOCX.
 *
 * Every word comes from scripts/demo/pleading-text.ts or the dataset; nothing
 * is copied from a real filing.
 */

export interface DocumentSection {
  heading?: string;
  paras: string[];
}

export interface DocumentSpec {
  layout: DocLayout;
  title: string;
  /** YYYY-MM-DD, the date the document bears. */
  date: string;
  /** Pleading caption. */
  court?: string;
  captionLeft?: string[];
  captionRight?: string[];
  /** Letter recipient block, or a memorandum's TO / FROM / RE lines. */
  addressee?: string[];
  subject?: string;
  salutation?: string;
  intro: string[];
  sections: DocumentSection[];
  /** Pleading paragraphs are numbered; letters and memoranda are not. */
  numbered: boolean;
  qa?: { q: string; a: string }[];
  prayer?: string[];
  closing: string[];
  signer: { name: string; position: string };
  /** The line under the signer's position; the firm unless the signer is someone else's. */
  signerOrg?: string;
  /** "Counsel for Plaintiff" — pleadings only. */
  counselFor?: string;
}

export const PDF_TYPE = 'application/pdf';
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const LONG_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };

export function longDate(day: string): string {
  return formatManila(`${day}T12:00:00+08:00`, LONG_DATE);
}

/** Obviously-invented attorney numbers: a real roll number must never print. */
function attorneyNumbers(name: string): string[] {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  const n = String(h).padStart(3, '0');
  return [
    `Roll of Attorneys No. 00${n} (demo)`,
    `IBP No. 000${n} · PTR No. 0000${n} · MCLE Compliance No. 0000-${n}`,
  ];
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

function letterhead(doc: PDFKit.PDFDocument, left: number, width: number): void {
  doc.font('Times-Bold').fontSize(15).fillColor('#1B2F45').text(FIRM.letterhead, left, doc.y, { width, align: 'center', characterSpacing: 2 });
  doc.font('Times-Italic').fontSize(10).fillColor('#6B5A33').text(FIRM.tagline, { width, align: 'center' });
  doc.font('Times-Roman').fontSize(9).fillColor('#444444').text(`${FIRM.address} · ${FIRM.phone} · ${FIRM.email}`, { width, align: 'center' });
  doc.moveDown(0.4);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.8).strokeColor('#B98D3E').stroke();
  doc.fillColor('#000000').strokeColor('#000000').lineWidth(1);
  doc.moveDown(1.2);
}

/** A generated document as a PDF — the finalized or filed version. */
export function renderPdf(spec: DocumentSpec): Promise<Buffer> {
  const pleading = spec.layout === 'pleading';
  const margins = pleading ? { top: 72, bottom: 72, left: 90, right: 72 } : { top: 60, bottom: 64, left: 72, right: 72 };
  const doc = new PDFDocument({ size: pleading ? 'LEGAL' : 'A4', margins, info: { Title: spec.title, Author: FIRM.name } });
  const done = collect(doc);
  const left = margins.left;
  const width = doc.page.width - margins.left - margins.right;

  const para = (text: string, opts: PDFKit.Mixins.TextOptions = {}) =>
    doc.text(text, { align: 'justify', lineGap: 3, paragraphGap: 8, indent: pleading ? 28 : 0, ...opts });

  if (pleading) {
    doc.font('Times-Roman').fontSize(11);
    doc.text('Republic of the Philippines', { align: 'center' });
    doc.font('Times-Bold').text((spec.court ?? '').toUpperCase(), { align: 'center' });
    doc.font('Times-Roman').moveDown(1.2);
    const top = doc.y;
    doc.text((spec.captionLeft ?? []).join('\n'), left, top, { width: width * 0.55 });
    const leftBottom = doc.y;
    doc.text((spec.captionRight ?? []).join('\n'), left + width * 0.62, top, { width: width * 0.38 });
    doc.y = Math.max(leftBottom, doc.y);
    doc.x = left;
    doc.moveDown(0.4);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
    doc.moveDown(1.2);
    doc.font('Times-Bold').fontSize(12).text(spec.title.toUpperCase(), { align: 'center' });
    doc.font('Times-Roman').fontSize(11).moveDown(1);
  } else {
    letterhead(doc, left, width);
    doc.font('Times-Roman').fontSize(11);
    if (spec.layout === 'memorandum') {
      doc.font('Times-Bold').fontSize(13).text('MEMORANDUM', { align: 'center' });
      doc.font('Times-Roman').fontSize(11).moveDown(0.8);
      for (const line of spec.addressee ?? []) doc.text(line);
      doc.moveDown(0.3);
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
      doc.moveDown(0.8);
    } else if (spec.layout === 'letter') {
      doc.text(longDate(spec.date));
      doc.moveDown(0.8);
      for (const line of spec.addressee ?? []) doc.text(line);
      doc.moveDown(0.8);
      if (spec.subject) {
        doc.font('Times-Bold').text(spec.subject, left + 36, doc.y, { width: width - 36 });
        doc.font('Times-Roman').moveDown(0.8);
        doc.x = left;
      }
      if (spec.salutation) {
        doc.text(spec.salutation);
        doc.moveDown(0.5);
      }
    } else {
      doc.font('Times-Bold').fontSize(13).text(spec.title.toUpperCase(), { align: 'center' });
      doc.font('Times-Roman').fontSize(11).moveDown(1);
    }
  }

  for (const p of spec.intro) para(p);

  if (spec.qa?.length) {
    spec.qa.forEach((item, i) => {
      doc.font('Times-Bold').text(`Q${i + 1}. `, { continued: true, indent: 28 });
      doc.font('Times-Roman').text(item.q, { align: 'justify', lineGap: 2 });
      doc.font('Times-Bold').text(`A${i + 1}. `, { continued: true, indent: 28 });
      doc.font('Times-Roman').text(item.a, { align: 'justify', lineGap: 2, paragraphGap: 8 });
    });
  }

  let n = 1;
  for (const section of spec.sections) {
    if (section.heading) {
      doc.moveDown(0.4);
      doc.font('Times-Bold').fontSize(11).text(section.heading, { align: pleading ? 'center' : 'left' });
      doc.font('Times-Roman').moveDown(0.3);
    }
    for (const p of section.paras) para(spec.numbered ? `${n++}.  ${p}` : p);
  }

  if (spec.prayer?.length) {
    doc.moveDown(0.6);
    doc.font('Times-Bold').text('P R A Y E R', { align: 'center' });
    doc.font('Times-Roman').moveDown(0.6);
    para('WHEREFORE, premises considered, it is respectfully prayed that:');
    spec.prayer.forEach((p, i) => para(`${String.fromCharCode(97 + i)})  ${p}`, { indent: 48 }));
    para('Other reliefs just and equitable under the premises are likewise prayed for.');
  }

  for (const p of spec.closing) para(p);

  doc.moveDown(1.2);
  const sigX = pleading ? left + width * 0.45 : left;
  const sigW = pleading ? width * 0.55 : width * 0.6;
  if (pleading) {
    para(`Makati City, ${longDate(spec.date)}.`, { indent: 28 });
    doc.moveDown(1);
    doc.font('Times-Bold').text(FIRM.letterhead, sigX, doc.y, { width: sigW });
    doc.font('Times-Roman').fontSize(9.5);
    if (spec.counselFor) doc.text(spec.counselFor, { width: sigW });
    doc.text(FIRM.address, { width: sigW });
    doc.text(`${FIRM.phone} · ${FIRM.email}`, { width: sigW });
    doc.moveDown(1);
    doc.fontSize(11).font('Times-Bold').text(spec.signer.name.toUpperCase(), { width: sigW });
    doc.font('Times-Roman').fontSize(9.5);
    for (const line of attorneyNumbers(spec.signer.name)) doc.text(line, { width: sigW });
  } else {
    doc.text(spec.layout === 'letter' ? 'Very truly yours,' : '', sigX, doc.y, { width: sigW });
    doc.moveDown(2);
    doc.font('Times-Bold').text(spec.signer.name.toUpperCase(), { width: sigW });
    doc.font('Times-Roman').text(spec.signer.position, { width: sigW });
    const org = spec.signerOrg ?? FIRM.name;
    if (org) doc.text(org, { width: sigW });
  }

  doc.end();
  return done;
}

/** A working draft of the same document, as DOCX. */
export function renderDocx(spec: DocumentSpec, draftNote: string): Promise<Buffer> {
  const F = 'Times New Roman';
  const run = (text: string, opts: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
    new TextRun({ text, font: F, size: opts.size ?? 22, bold: opts.bold, italics: opts.italics });
  const line = (text: string, opts: { bold?: boolean; italics?: boolean; size?: number; center?: boolean; justify?: boolean } = {}) =>
    new Paragraph({
      alignment: opts.center ? AlignmentType.CENTER : opts.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
      spacing: { after: 120 },
      children: [run(text, opts)],
    });

  const out: Paragraph[] = [line(`DRAFT — ${draftNote}`, { italics: true, size: 18 })];
  if (spec.layout === 'pleading') {
    out.push(line('Republic of the Philippines', { center: true }));
    out.push(line((spec.court ?? '').toUpperCase(), { center: true, bold: true }));
    for (const l of spec.captionLeft ?? []) out.push(line(l));
    for (const l of spec.captionRight ?? []) out.push(line(l));
    out.push(line('x - - - - - - - - - - - - - - - - - - - - - - - - - - - - x'));
    out.push(line(spec.title.toUpperCase(), { center: true, bold: true, size: 24 }));
  } else {
    out.push(line(FIRM.letterhead, { center: true, bold: true, size: 28 }));
    out.push(line(FIRM.address, { center: true, size: 18 }));
    if (spec.layout === 'memorandum') out.push(line('MEMORANDUM', { center: true, bold: true, size: 24 }));
    else if (spec.layout !== 'letter') out.push(line(spec.title.toUpperCase(), { center: true, bold: true, size: 24 }));
    if (spec.layout === 'letter') out.push(line(longDate(spec.date)));
    for (const l of spec.addressee ?? []) out.push(line(l));
    if (spec.subject) out.push(line(spec.subject, { bold: true }));
    if (spec.salutation) out.push(line(spec.salutation));
  }

  for (const p of spec.intro) out.push(line(p, { justify: true }));
  (spec.qa ?? []).forEach((item, i) => {
    out.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [run(`Q${i + 1}. `, { bold: true }), run(item.q)] }));
    out.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 }, children: [run(`A${i + 1}. `, { bold: true }), run(item.a)] }));
  });
  let n = 1;
  for (const section of spec.sections) {
    if (section.heading) out.push(line(section.heading, { bold: true, center: spec.layout === 'pleading' }));
    for (const p of section.paras) out.push(line(spec.numbered ? `${n++}.  ${p}` : p, { justify: true }));
  }
  if (spec.prayer?.length) {
    out.push(line('P R A Y E R', { bold: true, center: true }));
    out.push(line('WHEREFORE, premises considered, it is respectfully prayed that:', { justify: true }));
    spec.prayer.forEach((p, i) => out.push(line(`${String.fromCharCode(97 + i)})  ${p}`, { justify: true })));
  }
  for (const p of spec.closing) out.push(line(p, { justify: true }));
  out.push(line(''));
  out.push(line(spec.signer.name.toUpperCase(), { bold: true }));
  out.push(line(spec.signer.position));

  return Packer.toBuffer(new Document({ creator: FIRM.name, title: spec.title, sections: [{ children: out }] }));
}

/**
 * The copy that went out: the finalized PDF with a receiving stamp on its first
 * page — a court's or agency's RECEIVED, or the firm's own SENT OUT for a
 * letter. This is what the "Filed version" upload holds, and the only file the
 * client portal shows for finished work.
 */
export async function stampFiledCopy(pdf: Buffer, opts: { filedWithAuthority: boolean; day: string }): Promise<Buffer> {
  const stamp = opts.filedWithAuthority
    ? { title: 'RECEIVED', by: 'Receiving Section' }
    : { title: 'SENT OUT', by: FIRM.name };
  const doc = await PdfLibDocument.load(pdf);
  const page = doc.getPage(0);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const ink = rgb(0.11, 0.25, 0.62);
  // In the top margin, clear of the caption and the letterhead.
  const w = 150;
  const h = 48;
  const x = page.getWidth() - w - 24;
  const y = page.getHeight() - h - 8;
  page.drawRectangle({ x, y, width: w, height: h, borderColor: ink, borderWidth: 1.4, opacity: 0, borderOpacity: 0.85 });
  const lines: [string, typeof bold, number, number][] = [
    [stamp.title, bold, 13, h - 16],
    [longDate(opts.day).toUpperCase(), bold, 9, h - 30],
    [stamp.by, regular, 7.5, 8],
  ];
  for (const [text, font, size, dy] of lines) {
    const tw = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: x + (w - tw) / 2, y: y + dy, size, font, color: ink, opacity: 0.85 });
  }
  return Buffer.from(await doc.save());
}

/** A one-page record: an incoming court order, a corporate certificate, a receipt. */
export function renderRecordPdf(opts: {
  heading: string;
  issuer?: string;
  lines: string[];
  body?: string[];
  footer?: string;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 64, info: { Title: opts.heading } });
  const done = collect(doc);
  doc.font('Times-Roman').fontSize(10).fillColor('#333333');
  if (opts.issuer) {
    doc.text('Republic of the Philippines', { align: 'center' });
    doc.font('Times-Bold').text(opts.issuer.toUpperCase(), { align: 'center' });
    doc.moveDown(1);
  }
  doc.fillColor('#000000').font('Times-Bold').fontSize(14).text(opts.heading, { align: 'center' });
  doc.moveDown(1.2).font('Times-Roman').fontSize(11);
  for (const l of opts.lines) doc.text(l, { paragraphGap: 4 });
  doc.moveDown(0.8);
  for (const p of opts.body ?? []) doc.text(p, { align: 'justify', paragraphGap: 8, lineGap: 2 });
  doc.moveDown(2);
  doc.fontSize(8.5).fillColor('#777777').text(
    opts.footer ?? 'Demonstration document — every name and figure in it is fictional.',
    { align: 'center' },
  );
  doc.end();
  return done;
}
