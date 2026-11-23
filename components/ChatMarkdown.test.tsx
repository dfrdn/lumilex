import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatMarkdown from './ChatMarkdown';

const html = (content: string) => renderToStaticMarkup(<ChatMarkdown content={content} />);

describe('ChatMarkdown links', () => {
  it('renders a markdown link', () => {
    const out = html('[View meeting](https://app.example.com/dashboard/meetings/temp-meetings-1792571473372)');
    expect(out).toContain('href="https://app.example.com/dashboard/meetings/temp-meetings-1792571473372"');
    expect(out).toContain('>View meeting</a>');
    expect(out).not.toContain('[View meeting]');
  });

  it('keeps underscores and asterisks inside URLs out of emphasis', () => {
    const out = html('See https://example.com/a_b_c and [x](https://example.com/*y*)');
    expect(out).toContain('href="https://example.com/a_b_c"');
    expect(out).toContain('href="https://example.com/*y*"');
    expect(out).not.toContain('<em>');
  });

  it('leaves trailing punctuation outside a bare URL', () => {
    const out = html('Open https://example.com/x.');
    expect(out).toContain('href="https://example.com/x"');
    expect(out).toContain('</a>.');
  });

  it('opens relative links in place and refuses other schemes', () => {
    expect(html('[Matter](/dashboard/matters/1)')).toMatch(/<a href="\/dashboard\/matters\/1" class="[^"]*">/);
    const out = html('[bad](javascript:alert(1))');
    expect(out).not.toContain('<a');
  });

  it('still renders bold around and inside a link', () => {
    const out = html('**Saved** [**here**](https://example.com)');
    expect(out).toContain('<strong>Saved</strong>');
    expect(out).toContain('<strong>here</strong></a>');
  });
});
