import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { cleanDocx } from './cleanup';

async function docx(parts: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, xml] of Object.entries(parts)) zip.file(name, xml);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('cleanDocx', () => {
  it('accepts tracked changes and strips comment anchors in footnotes, not just the body', async () => {
    const input = await docx({
      'word/document.xml': '<w:body><w:p><w:ins w:id="1"><w:r><w:t>kept</w:t></w:r></w:ins></w:p></w:body>',
      'word/footnotes.xml':
        '<w:footnotes><w:footnote w:id="1"><w:p>' +
        '<w:commentRangeStart w:id="9"/>' +
        '<w:del w:id="2"><w:r><w:delText>G.R. No. 1</w:delText></w:r></w:del>' +
        '<w:ins w:id="3"><w:r><w:t>G.R. No. 188611</w:t></w:r></w:ins>' +
        '<w:commentRangeEnd w:id="9"/><w:r><w:commentReference w:id="9"/></w:r>' +
        '</w:p></w:footnote></w:footnotes>',
      'word/comments.xml': '<w:comments/>',
    });

    const zip = await JSZip.loadAsync(await cleanDocx(input));
    const body = await zip.files['word/document.xml'].async('string');
    const notes = await zip.files['word/footnotes.xml'].async('string');

    expect(body).toBe('<w:body><w:p><w:r><w:t>kept</w:t></w:r></w:p></w:body>');
    expect(notes).toBe('<w:footnotes><w:footnote w:id="1"><w:p><w:r><w:t>G.R. No. 188611</w:t></w:r></w:p></w:footnote></w:footnotes>');
    expect(zip.files['word/comments.xml']).toBeUndefined();
  });

  it('keeps the document when a paragraph mark carries a deleted-mark marker', async () => {
    // A self-closing <w:del/> in a paragraph's own run properties marks the
    // paragraph mark as deleted. Read as an opening tag it swallows every
    // paragraph up to the next </w:del> — here, the whole body.
    const input = await docx({
      'word/document.xml':
        '<w:body>' +
        '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr><w:r><w:t>first half</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t> second half</w:t></w:r></w:p>' +
        '<w:p><w:del w:id="2"><w:r><w:delText>struck</w:delText></w:r></w:del></w:p>' +
        '</w:body>',
    });

    const zip = await JSZip.loadAsync(await cleanDocx(input));
    const body = await zip.files['word/document.xml'].async('string');

    // Accepting a deleted paragraph mark joins the two paragraphs, and the
    // surviving mark is the second one's — so its properties win.
    expect(body).toBe(
      '<w:body>' +
        '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>first half</w:t></w:r><w:r><w:t> second half</w:t></w:r></w:p>' +
        '<w:p></w:p>' +
        '</w:body>',
    );
  });

  it('reads the paragraph properties past the copy <w:pPrChange> nests inside them', async () => {
    const input = await docx({
      'word/document.xml':
        '<w:body>' +
        '<w:p><w:pPr><w:ind w:left="900"/><w:rPr><w:del w:id="1"/></w:rPr>' +
        '<w:pPrChange w:id="2" w:author="A"><w:pPr><w:ind w:left="0"/></w:pPr></w:pPrChange>' +
        '</w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '</w:body>',
    });

    const zip = await JSZip.loadAsync(await cleanDocx(input));
    const body = await zip.files['word/document.xml'].async('string');

    expect(body).toBe('<w:body><w:p><w:r><w:t>one</w:t></w:r><w:r><w:t>two</w:t></w:r></w:p></w:body>');
  });

  it('removes only the run holding a comment reference, not the text before it', async () => {
    // Two reference runs: an unbounded match for the first one's run
    // properties reaches the second and deletes everything in between.
    const input = await docx({
      'word/document.xml':
        '<w:body><w:p>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:commentReference w:id="1"/></w:r>' +
        '<w:r><w:t>text between the two comments</w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:commentReference w:id="2"/></w:r>' +
        '</w:p></w:body>',
      'word/comments.xml': '<w:comments/>',
    });

    const zip = await JSZip.loadAsync(await cleanDocx(input));
    const body = await zip.files['word/document.xml'].async('string');

    expect(body).toBe('<w:body><w:p><w:r><w:t>text between the two comments</w:t></w:r></w:p></w:body>');
  });
});
