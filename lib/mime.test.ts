import { describe, it, expect } from 'vitest';
import { contentTypeFor, FALLBACK_CONTENT_TYPE } from './mime';

describe('contentTypeFor', () => {
  it('keeps a specific declared type', () => {
    expect(contentTypeFor('order.pdf', 'application/pdf')).toBe('application/pdf');
    expect(contentTypeFor('scan.jpg', 'image/jpeg')).toBe('image/jpeg');
  });

  it('trusts the declared type over the extension when they disagree', () => {
    // Graph knows what it received; a misnamed file shouldn't be re-guessed.
    expect(contentTypeFor('order.txt', 'application/pdf')).toBe('application/pdf');
  });

  it('falls back to the extension when the sender declared octet-stream', () => {
    expect(contentTypeFor('order.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(contentTypeFor('brief.docx', 'binary/octet-stream')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('falls back to the extension when nothing is declared', () => {
    expect(contentTypeFor('order.pdf')).toBe('application/pdf');
    expect(contentTypeFor('order.pdf', null)).toBe('application/pdf');
    expect(contentTypeFor('order.pdf', '')).toBe('application/pdf');
  });

  it('is case-insensitive about the extension', () => {
    expect(contentTypeFor('ORDER.PDF')).toBe('application/pdf');
    expect(contentTypeFor('Scan.JPEG')).toBe('image/jpeg');
  });

  it('ignores parameters on the declared type when judging specificity', () => {
    expect(contentTypeFor('a.pdf', 'application/octet-stream; name="a.pdf"')).toBe('application/pdf');
    expect(contentTypeFor('a.csv', 'text/csv; charset=utf-8')).toBe('text/csv; charset=utf-8');
  });

  it('handles dotted names and returns the fallback for unknown extensions', () => {
    expect(contentTypeFor('Case No. 038-25 Order.pdf')).toBe('application/pdf');
    expect(contentTypeFor('archive.xyz')).toBe(FALLBACK_CONTENT_TYPE);
    expect(contentTypeFor('noextension')).toBe(FALLBACK_CONTENT_TYPE);
  });

  it('maps the office and image types the firm exchanges', () => {
    expect(contentTypeFor('a.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(contentTypeFor('a.doc')).toBe('application/msword');
    expect(contentTypeFor('a.png')).toBe('image/png');
  });
});
