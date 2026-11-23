import JSZip from 'jszip';
import { getUpdatedTemplateBuffer } from './template-updater';

/**
 * Putting a document body on the firm's letterhead.
 *
 * The bundled template, with the firm's own letterhead built into its headers
 * (lib/docx/template-updater.ts), is the sheet; the body is swapped in and the
 * section — which carries the letterhead's page frame and first-page header —
 * is kept. Letters built from paragraphs (lib/docx/letter-body.ts) go through
 * here rather than setting up a page of their own.
 */

export interface LetterheadBody {
  bodyXml: string;
  /** The template's numbering part, returned with any list instances the body added. */
  numberingXml?: string;
  /** The template's footnotes part, returned with any notes the body added. */
  footnotesXml?: string;
}

export async function placeOnLetterhead(
  firmId: string,
  build: (parts: { numberingXml: string; footnotesXml: string }) => LetterheadBody,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await getUpdatedTemplateBuffer(firmId));

  const documentXml = await zip.files['word/document.xml'].async('string');
  const bodyStart = documentXml.indexOf('<w:body>');
  const bodyEnd = documentXml.indexOf('</w:body>');
  if (bodyStart === -1 || bodyEnd === -1) {
    throw new Error('Could not find <w:body> in document.xml');
  }
  const existingBody = documentXml.substring(bodyStart + '<w:body>'.length, bodyEnd);
  const sectPr = existingBody.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] ?? '';

  const built = build({
    numberingXml: (await zip.file('word/numbering.xml')?.async('string')) ?? '',
    footnotesXml: (await zip.file('word/footnotes.xml')?.async('string')) ?? '',
  });

  zip.file('word/document.xml',
    documentXml.substring(0, bodyStart) + `<w:body>${built.bodyXml}${sectPr}</w:body>` + documentXml.substring(bodyEnd + '</w:body>'.length));
  if (built.numberingXml) zip.file('word/numbering.xml', built.numberingXml);
  if (built.footnotesXml) zip.file('word/footnotes.xml', built.footnotesXml);

  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
