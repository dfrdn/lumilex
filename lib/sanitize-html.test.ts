import { describe, it, expect } from 'vitest';
import { decodeEntities, sanitizeHandbookHtml } from './sanitize-html';
import { sanitizeCommentHtml } from './sanitize-comment';

describe('sanitizeHandbookHtml', () => {
  it('keeps what the rich-text editor writes', () => {
    const html = [
      '<h2 style="text-align: center">Filing</h2>',
      '<p>Serve <strong>both</strong> parties, <em>then</em> <mark>file</mark>.</p>',
      '<ol start="3"><li>One</li></ol>',
      '<blockquote><p>Quoted</p></blockquote>',
      '<hr>',
      '<table><thead><tr><th colspan="2">Fees</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>',
    ].join('');
    expect(sanitizeHandbookHtml(html)).toBe(html);
  });

  it('keeps the lead paragraph the Rules of Court import writes, and no other class', () => {
    expect(sanitizeHandbookHtml('<p class="lead">x</p>')).toBe('<p class="lead">x</p>');
    expect(sanitizeHandbookHtml('<p class="fixed inset-0 z-50">x</p>')).toBe('<p>x</p>');
  });

  it('reduces inline style to text alignment', () => {
    expect(sanitizeHandbookHtml('<p style="text-align: right; background: url(x)">x</p>'))
      .toBe('<p style="text-align: right">x</p>');
    expect(sanitizeHandbookHtml('<p style="position:fixed">x</p>')).toBe('<p>x</p>');
  });

  it('removes scripts, images, forms and event handlers', () => {
    expect(sanitizeHandbookHtml('<p onclick="steal()">a</p><script>alert(1)</script>')).toBe('<p>a</p>');
    expect(sanitizeHandbookHtml('<img src=x onerror="alert(1)">b')).toBe('b');
    expect(sanitizeHandbookHtml('<form action="https://evil"><input name="p"><button>Go</button></form>')).toBe('Go');
    expect(sanitizeHandbookHtml('<svg><script>alert(1)</script></svg>ok')).toBe('ok');
  });

  it('refuses script URLs however they are spelled', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'javascript&#58;alert(1)', 'java&#x09;script:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(sanitizeHandbookHtml(`<a href="${href}">x</a>`)).toBe('<a>x</a>');
    }
  });

  it('keeps web, mail, phone and relative links', () => {
    for (const href of ['https://sc.judiciary.gov.ph/', 'mailto:a@b.ph', 'tel:+632', '/dashboard/library/3', '#section-2']) {
      expect(sanitizeHandbookHtml(`<a href="${href}">x</a>`)).toBe(`<a href="${href}">x</a>`);
    }
  });

  it('is stable across saves: an escaped query string is not escaped again', () => {
    const once = sanitizeHandbookHtml('<a href="https://x.ph/?a=1&amp;b=2">x</a>');
    expect(once).toBe('<a href="https://x.ph/?a=1&amp;b=2">x</a>');
    expect(sanitizeHandbookHtml(once)).toBe(once);
  });

  it('gives a new-tab link noopener, replacing whatever rel it carried', () => {
    expect(sanitizeHandbookHtml('<a href="https://x.ph" target="_blank" rel="opener">x</a>'))
      .toBe('<a href="https://x.ph" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it('drops a target other than a new tab', () => {
    expect(sanitizeHandbookHtml('<a href="https://x.ph" target="_top">x</a>')).toBe('<a href="https://x.ph">x</a>');
  });
});

describe('decodeEntities', () => {
  it('decodes numeric, hex and the named entities a URL can hide behind', () => {
    expect(decodeEntities('a&#58;b&#x3A;c&colon;d&amp;e')).toBe('a:b:c:d&e');
  });

  it('leaves an unknown name alone', () => {
    expect(decodeEntities('&b=2')).toBe('&b=2');
  });
});

describe('sanitizeCommentHtml shares the core', () => {
  it('refuses an entity-encoded script URL', () => {
    expect(sanitizeCommentHtml('<a href="javascript&#58;alert(1)">x</a>')).toBe('<a>x</a>');
  });
});
