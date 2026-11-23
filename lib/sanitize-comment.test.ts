import { describe, it, expect } from 'vitest';
import { sanitizeCommentHtml } from './sanitize-comment';

describe('sanitizeCommentHtml', () => {
  it('keeps allow-listed formatting tags intact', () => {
    const html = '<p>Hello <strong>world</strong> and <em>friends</em></p>';
    expect(sanitizeCommentHtml(html)).toBe(html);
  });

  it('strips <script> tags and their contents', () => {
    const out = sanitizeCommentHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>hi</p>');
    expect(out).not.toContain('alert');
  });

  it('strips iframe/style/object and similar embedded tags', () => {
    expect(sanitizeCommentHtml('<iframe src="evil"></iframe>ok')).toBe('ok');
    expect(sanitizeCommentHtml('<style>.x{}</style>text')).toBe('text');
  });

  it('drops disallowed tags but keeps their text content', () => {
    expect(sanitizeCommentHtml('<div>kept</div>')).toBe('kept');
  });

  it('removes inline event handlers', () => {
    const out = sanitizeCommentHtml('<p onclick="steal()">x</p>');
    expect(out).toBe('<p>x</p>');
    expect(out).not.toContain('onclick');
  });

  it('drops javascript: and data: URLs on links', () => {
    expect(sanitizeCommentHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeCommentHtml('<a href="data:text/html,evil">x</a>')).toBe('<a>x</a>');
  });

  it('keeps safe hrefs', () => {
    expect(sanitizeCommentHtml('<a href="https://example.law">site</a>')).toContain('href="https://example.law"');
  });

  it('scrubs attributes not on the allow-list', () => {
    const out = sanitizeCommentHtml('<p style="color:red" class="evil">x</p>');
    expect(out).toBe('<p>x</p>');
  });

  it('preserves TipTap mention data attributes on spans', () => {
    const html = '<span data-type="mention" data-id="42" data-label="Atty. Cruz">@Cruz</span>';
    const out = sanitizeCommentHtml(html);
    expect(out).toContain('data-id="42"');
    expect(out).toContain('data-label="Atty. Cruz"');
  });

  it('forces rel="noopener noreferrer" on target=_blank links', () => {
    const out = sanitizeCommentHtml('<a href="https://x.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('escapes special characters in attribute values', () => {
    const out = sanitizeCommentHtml('<a href="https://x.com?a=1&b=2">x</a>');
    expect(out).toContain('&amp;');
    expect(out).not.toContain('a=1&b=2');
  });

  it('handles empty/garbage input without throwing', () => {
    expect(sanitizeCommentHtml('')).toBe('');
    expect(sanitizeCommentHtml('plain text')).toBe('plain text');
  });
});
