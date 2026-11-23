import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { extractPdfText } from './pdf-text';

function renderPdf(title: string, body: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 64 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  doc.font('Times-Bold').fontSize(14).text(title, { align: 'center' });
  doc.moveDown().font('Times-Roman').fontSize(11).text(body);
  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

const BODY =
  'Acting on the submission of the parties, and finding the same to be in order, the Court hereby ' +
  'sets this matter for further proceedings on the date indicated in the notice attached hereto.';

// Before this helper, the same valid PDFs failed about two times in three with
// "bad XRef entry" when pdf-parse was handed a Node Buffer. The failure is
// intermittent, so each shape is read many times.
describe('extractPdfText', () => {
  it('reads a valid PDF from a Buffer that starts inside a larger allocation', async () => {
    const pdf = await renderPdf('RESOLUTION', BODY);
    for (let i = 0; i < 12; i++) {
      // Node hands out small Buffers from a shared pool, at a non-zero offset.
      const pooled = Buffer.concat([Buffer.alloc(8 + i), pdf]).subarray(8 + i);
      expect(pooled.byteOffset).toBeGreaterThan(0);
      const { text, pageCount } = await extractPdfText(pooled);
      expect(pageCount).toBe(1);
      expect(text).toContain('RESOLUTION');
      expect(text).toContain('further proceedings');
    }
  });

  it('reads a valid PDF from a Buffer made from a fetched ArrayBuffer', async () => {
    for (let i = 0; i < 12; i++) {
      const pdf = await renderPdf(`ORDER ${i}`, BODY);
      const fetched = Buffer.from(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength));
      const { text } = await extractPdfText(fetched);
      expect(text).toContain(`ORDER ${i}`);
    }
  });

  it('leaves the caller’s bytes untouched', async () => {
    const pdf = await renderPdf('NOTICE', BODY);
    const before = Buffer.from(pdf);
    await extractPdfText(pdf);
    expect(pdf.equals(before)).toBe(true);
  });
});
