import { describe, it, expect } from 'vitest';
import { baseDocumentName, finalDocxName, finalPdfName } from './file-names';

describe('finalDocxName', () => {
  it('marks a freshly uploaded document', () => {
    expect(finalDocxName('Consultancy Agreement.docx')).toBe('Consultancy Agreement_FINAL.docx');
  });

  it('stays the same when a cancelled signing round is finalized again', () => {
    const once = finalDocxName('Consultancy Agreement.docx');
    expect(finalDocxName(once)).toBe(once);
    expect(finalDocxName(finalDocxName(once))).toBe(once);
  });

  it('drops a stacked suffix left by earlier runs', () => {
    expect(finalDocxName('Motion_FINAL_FINAL_FINAL.docx')).toBe('Motion_FINAL.docx');
    expect(finalDocxName('Motion_FINAL_SIGNED.docx')).toBe('Motion_FINAL.docx');
  });

  it('leaves a document whose own name ends in the word alone', () => {
    expect(finalDocxName('Notice of Final Award.docx')).toBe('Notice of Final Award_FINAL.docx');
  });
});

describe('finalPdfName', () => {
  it('marks the PDF signed only when signatures were applied', () => {
    expect(finalPdfName('Motion_FINAL.docx', true)).toBe('Motion_FINAL_SIGNED.pdf');
    expect(finalPdfName('Motion_FINAL.docx', false)).toBe('Motion_FINAL.pdf');
  });

  it('does not restack when the DOCX name already carried marks', () => {
    expect(finalPdfName('Motion_FINAL_FINAL.docx', true)).toBe('Motion_FINAL_SIGNED.pdf');
  });
});

describe('baseDocumentName', () => {
  it('strips the extension and every trailing mark', () => {
    expect(baseDocumentName('Deed_FINAL_SIGNED.pdf')).toBe('Deed');
    expect(baseDocumentName('Deed-FINAL.docx')).toBe('Deed');
    expect(baseDocumentName('Deed.docx')).toBe('Deed');
  });
});
