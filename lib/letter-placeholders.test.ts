import { describe, expect, it } from 'vitest';
import { chipsToTokens, tokensToChips } from './letter-placeholders';

describe('placeholder chips', () => {
  it('turn back into tokens, digits in the key included', () => {
    const html = tokensToChips('<p>Due {{dau3Due}}; {{mark}}.</p>', ['dau3Due', 'mark']);
    const rendered = html.replace(/<span data-placeholder="(\w+)"><\/span>/g, '<span data-placeholder="$1" class="chip" contenteditable="false">Label</span>');
    expect(chipsToTokens(rendered)).toBe('<p>Due {{dau3Due}}; {{mark}}.</p>');
  });
});
