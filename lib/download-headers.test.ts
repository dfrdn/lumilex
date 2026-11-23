import { describe, it, expect } from 'vitest';
import { attachmentDisposition, inlineDisposition } from './download-headers';

describe('attachmentDisposition', () => {
  it('emits both filename and filename* for a plain ASCII name', () => {
    expect(attachmentDisposition('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it('downgrades non-ASCII chars in the legacy filename but preserves them in filename*', () => {
    const out = attachmentDisposition('résumé.pdf');
    expect(out).toContain('filename="r_sum_.pdf"');
    expect(out).toContain(`filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`);
  });

  it('replaces quotes and backslashes in the ASCII fallback', () => {
    expect(attachmentDisposition('a"b\\c.pdf')).toContain('filename="a_b_c.pdf"');
  });

  it('percent-encodes RFC 5987 attr-char exclusions like parens and spaces', () => {
    const out = attachmentDisposition('Final (v2).pdf');
    expect(out).toContain(`filename*=UTF-8''Final%20%28v2%29.pdf`);
  });

  it('falls back to "file" for an empty/whitespace name', () => {
    expect(attachmentDisposition('   ')).toBe(
      `attachment; filename="file"; filename*=UTF-8''file`,
    );
  });
});

describe('inlineDisposition', () => {
  it('uses the inline disposition type', () => {
    expect(inlineDisposition('preview.pdf')).toBe(
      `inline; filename="preview.pdf"; filename*=UTF-8''preview.pdf`,
    );
  });
});
