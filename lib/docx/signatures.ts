// ── DOCX Signature Insertion ─────────────────────────────────────
// Inserts e-signature images at the end of a DOCX document body.

import JSZip from 'jszip';

export interface Signatory {
  personId: string;
  name: string;
  position: string;
  signatureBuffer: Buffer;
}

/**
 * Insert signature images into a DOCX buffer.
 * Each signatory gets a signature block at the end of the document:
 * - Signature image
 * - Name (bold)
 * - Position (italic)
 */
export async function insertSignatures(
  docxBuffer: Buffer,
  signatories: Signatory[],
): Promise<Buffer> {
  if (signatories.length === 0) return docxBuffer;

  const zip = await JSZip.loadAsync(docxBuffer);

  // Read existing relationships to determine next rId
  const relsFile = zip.files['word/_rels/document.xml.rels'];
  let rels = relsFile ? await relsFile.async('string') : '';
  const rIdMatches = rels.match(/Id="rId(\d+)"/g) || [];
  let nextRId =
    rIdMatches.reduce((max, m) => {
      const num = parseInt(m.match(/rId(\d+)/)![1]);
      return Math.max(max, num);
    }, 0) + 1;

  // Ensure PNG content type exists
  const ctFile = zip.files['[Content_Types].xml'];
  if (ctFile) {
    let ct = await ctFile.async('string');
    if (!ct.includes('Extension="png"')) {
      ct = ct.replace(
        '</Types>',
        '<Default Extension="png" ContentType="image/png"/></Types>',
      );
    }
    zip.file('[Content_Types].xml', ct);
  }

  const signatureXmlBlocks: string[] = [];

  // Add a spacer paragraph before signatures
  signatureXmlBlocks.push(
    '<w:p><w:pPr><w:spacing w:before="600"/></w:pPr></w:p>',
  );

  for (const sig of signatories) {
    const rId = `rId${nextRId++}`;
    const mediaPath = `word/media/signature_${sig.personId}.png`;

    // Add image to zip
    zip.file(mediaPath, sig.signatureBuffer);

    // Add relationship
    const relEntry = `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/signature_${sig.personId}.png"/>`;
    rels = rels.replace('</Relationships>', `${relEntry}</Relationships>`);

    // Get image dimensions (default to reasonable signature size)
    // 2 inches wide x 0.75 inch tall in EMUs (1 inch = 914400 EMUs)
    const cx = 1828800; // 2 inches
    const cy = 685800; // 0.75 inches

    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // Signature image paragraph
    signatureXmlBlocks.push(
      `<w:p>` +
        `<w:pPr><w:spacing w:before="200" w:after="0"/></w:pPr>` +
        `<w:r>` +
        `<w:drawing>` +
        `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
        `<wp:extent cx="${cx}" cy="${cy}"/>` +
        `<wp:docPr id="${nextRId}" name="Signature ${esc(sig.name)}"/>` +
        `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:nvPicPr>` +
        `<pic:cNvPr id="${nextRId}" name="signature_${sig.personId}.png"/>` +
        `<pic:cNvPicPr/>` +
        `</pic:nvPicPr>` +
        `<pic:blipFill>` +
        `<a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>` +
        `<a:stretch><a:fillRect/></a:stretch>` +
        `</pic:blipFill>` +
        `<pic:spPr>` +
        `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
        `</pic:spPr>` +
        `</pic:pic>` +
        `</a:graphicData>` +
        `</a:graphic>` +
        `</wp:inline>` +
        `</w:drawing>` +
        `</w:r>` +
        `</w:p>`,
    );

    // Name paragraph (bold)
    signatureXmlBlocks.push(
      `<w:p>` +
        `<w:pPr><w:spacing w:before="60" w:after="0"/></w:pPr>` +
        `<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
        `<w:t>${esc(sig.name)}</w:t></w:r>` +
        `</w:p>`,
    );

    // Position paragraph (italic)
    signatureXmlBlocks.push(
      `<w:p>` +
        `<w:pPr><w:spacing w:before="0" w:after="200"/></w:pPr>` +
        `<w:r><w:rPr><w:i/><w:iCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>` +
        `<w:t>${esc(sig.position)}</w:t></w:r>` +
        `</w:p>`,
    );
  }

  // Update relationships file
  zip.file('word/_rels/document.xml.rels', rels);

  // Insert signature blocks before </w:body>
  const docFile = zip.files['word/document.xml'];
  if (docFile) {
    let docXml = await docFile.async('string');
    const bodyCloseIdx = docXml.lastIndexOf('</w:body>');
    if (bodyCloseIdx !== -1) {
      docXml =
        docXml.substring(0, bodyCloseIdx) +
        signatureXmlBlocks.join('') +
        docXml.substring(bodyCloseIdx);
    }
    zip.file('word/document.xml', docXml);
  }

  const output = await zip.generateAsync({ type: 'nodebuffer' });
  return Buffer.from(output);
}
