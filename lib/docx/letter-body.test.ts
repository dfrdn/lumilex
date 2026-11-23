import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { buildLetterBody } from './letter-body';

async function templateParts() {
  const zip = await JSZip.loadAsync(readFileSync(path.join(__dirname, 'template.docx')));
  return {
    zip,
    numberingXml: await zip.file('word/numbering.xml')!.async('string'),
    footnotesXml: await zip.file('word/footnotes.xml')!.async('string'),
  };
}

describe('buildLetterBody', () => {
  it('writes keepNext where Word expects it in the paragraph properties', async () => {
    const { numberingXml, footnotesXml } = await templateParts();
    const { bodyXml } = buildLetterBody([
      { text: 'Very truly yours,', keepNext: true },
      { text: 'Closing body.', style: 'BodyText', keepNext: true },
      { text: 'Last.' },
    ], { numberingXml, footnotesXml });
    expect(bodyXml).toContain('<w:pPr><w:keepNext/><w:jc');
    expect(bodyXml).toContain('<w:pPr><w:pStyle w:val="BodyText"/><w:keepNext/>');
    expect(bodyXml.match(/<w:keepNext\/>/g)).toHaveLength(2);
  });

  it('uses the template heading styles, restarts each list at 1, and writes real footnotes', async () => {
    const { numberingXml, footnotesXml } = await templateParts();
    const built = buildLetterBody([
      { text: 'Subject: **Demand for payment**' },
      { type: 'heading', level: 1, text: 'Background' },
      { type: 'item', text: 'First.' },
      { type: 'item', level: 1, text: 'Sub-point.[[fn:*Ople v. Torres*, G.R. No. 127685, 23 July 1998.]]' },
      { text: 'A paragraph between lists.' },
      { type: 'item', text: 'Second list, first entry.' },
      { type: 'heading', level: 2, text: 'Sub-heading' },
    ], { numberingXml, footnotesXml });

    expect(built.bodyXml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(built.bodyXml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(built.bodyXml).not.toMatch(/>(?:I|1|a)\.\s/);

    const listIds = [...built.bodyXml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(listIds).toHaveLength(3);
    expect(listIds[0]).toBe(listIds[1]);
    expect(listIds[2]).not.toBe(listIds[0]);
    for (const id of new Set(listIds)) {
      expect(built.numberingXml).toMatch(new RegExp(`<w:num w:numId="${id}"><w:abstractNumId w:val="\\d+"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>`));
    }

    expect(built.footnotesXml.match(/<w:footnote w:id="1">/g)).toHaveLength(1);
    expect(built.bodyXml).toContain('<w:footnoteReference w:id="1"/>');

  });
});

describe('justification', () => {
  it('justifies run-on prose', async () => {
    const { numberingXml, footnotesXml } = await templateParts();
    const built = buildLetterBody([{ text: 'A paragraph of ordinary prose.' }], { numberingXml, footnotesXml });
    expect(built.bodyXml).toContain('<w:jc w:val="both"/>');
  });

  it('leaves a paragraph broken with line breaks unjustified', async () => {
    // Justification stretches every line but the last, so an address block or a
    // signature block written with \n comes out spread across the measure — and
    // the printed name splits into separate runs, which is what finalization
    // looks for when it places a signature.
    const { numberingXml, footnotesXml } = await templateParts();
    const built = buildLetterBody(
      [{ text: 'Very truly yours,\n\nFor the Firm:\n\n\nANDRES MIGUEL B. SANTOS\nPartner' }],
      { numberingXml, footnotesXml },
    );
    expect(built.bodyXml).not.toContain('<w:jc w:val="both"/>');
    expect(built.bodyXml).toContain('<w:br/>');
  });

  it('still honours an explicit alignment', async () => {
    const { numberingXml, footnotesXml } = await templateParts();
    const built = buildLetterBody([{ text: 'Centred\nover two lines', alignment: 'center' }], { numberingXml, footnotesXml });
    expect(built.bodyXml).toContain('<w:jc w:val="center"/>');
  });
});

describe('paragraph options', () => {
  it('sets small capitals', async () => {
    const { numberingXml, footnotesXml } = await templateParts();
    const built = buildLetterBody([{ text: 'Andres Miguel B. Santos', bold: true, smallCaps: true }], { numberingXml, footnotesXml });
    expect(built.bodyXml).toContain('<w:smallCaps/>');
  });

  it('applies a named style and leaves its alignment to the style', async () => {
    const { numberingXml, footnotesXml } = await templateParts();
    const built = buildLetterBody([{ text: 'Memorandum', style: 'Title' }], { numberingXml, footnotesXml });
    expect(built.bodyXml).toContain('<w:pStyle w:val="Title"/>');
    expect(built.bodyXml).not.toContain('<w:jc ');
  });

  it('turns a tab in the text into a real tab, at the stop given', async () => {
    // A tab character inside <w:t> is only whitespace to Word.
    const { numberingXml, footnotesXml } = await templateParts();
    const built = buildLetterBody([{ text: '**TO:**\t[Name]', tabStop: 1080 }], { numberingXml, footnotesXml });
    expect(built.bodyXml).toContain('<w:tabs><w:tab w:val="left" w:pos="1080"/></w:tabs>');
    expect(built.bodyXml).toContain('<w:tab/>');
    expect(built.bodyXml).not.toMatch(/<w:t[^>]*>[^<]*\t/);
  });

  it('hangs a long value under itself, not under its label', async () => {
    const { numberingXml, footnotesXml } = await templateParts();
    const built = buildLetterBody([{ text: '**RE:**\tA subject long enough to wrap', tabStop: 1080 }], { numberingXml, footnotesXml });
    expect(built.bodyXml).toContain('<w:ind w:left="1080" w:hanging="1080"/>');
  });
});

