import { describe, expect, it } from 'vitest';
import { htmlToMarkup, markupToHtml } from './letter-markup';
import { STANDARD_BLOCKS } from '@/lib/billing/letter-blocks';

describe('letter markup and editor HTML', () => {
  it('turns stored wording into paragraphs with marks', () => {
    expect(markupToHtml('Subject: **Billing – {{period}}**\n\n*Note* the __date__ & <time>.'))
      .toBe('<p>Subject: <strong>Billing – {{period}}</strong></p><p><em>Note</em> the <u>date</u> &amp; &lt;time&gt;.</p>');
  });

  it('reads the editor back into stored wording', () => {
    expect(htmlToMarkup('<p>Pay <strong>{{amountToRemit}}</strong> by {{dueDate}}&nbsp;&amp; <em>thanks</em>.</p><p>Second<br>line, <u>here</u>.</p>'))
      .toBe('Pay **{{amountToRemit}}** by {{dueDate}} & *thanks*.\n\nSecond line, __here__.');
  });

  it('turns "- " lines into a numbered list after the paragraph’s text, and back', () => {
    const markup = 'Send any of:\n- **labels**;\n- photos.\n\nThanks.';
    const html = markupToHtml(markup);
    expect(html).toBe('<p>Send any of:</p><ol><li><p><strong>labels</strong>;</p></li><li><p>photos.</p></li></ol><p>Thanks.</p>');
    expect(htmlToMarkup(html)).toBe('Send any of:\n\n- **labels**;\n- photos.\n\nThanks.');
  });

  it('round-trips every built-in paragraph unchanged', () => {
    for (const b of STANDARD_BLOCKS) expect(htmlToMarkup(markupToHtml(b.body)), b.key).toBe(b.body);
  });
});
