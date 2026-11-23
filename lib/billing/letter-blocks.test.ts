import { describe, expect, it } from 'vitest';
import { letterWording, STANDARD_BLOCKS, wordingParagraphs, wordingProblem } from './letter-blocks';
import { fillWording } from '@/lib/letter-wording';
import { DEFAULT_LETTER_PARAGRAPHS } from './paragraphs';

describe('fillWording', () => {
  it('fills fields and drops a [[ ]] phrase whose field is blank', () => {
    const body = 'for {{period}}[[ dated {{engagementDate}}]].';
    expect(fillWording(body, { period: 'May 2026', engagementDate: '14 August 2025' })).toBe('for May 2026 dated 14 August 2025.');
    expect(fillWording(body, { period: 'May 2026', engagementDate: '' })).toBe('for May 2026.');
  });

  it('splits paragraphs on a blank line and joins wrapped lines', () => {
    expect(wordingParagraphs('One\nstill one.\n\nTwo.', {})).toEqual(['One still one.', 'Two.']);
  });
});

describe('wordingProblem', () => {
  it('accepts every built-in default', () => {
    for (const b of STANDARD_BLOCKS) expect(wordingProblem(b.body), b.key).toBeNull();
  });

  it('catches a mistyped field, an unclosed [[ and an empty paragraph', () => {
    expect(wordingProblem('Due {{dueDat}}.')).toBe('Unknown field: {{dueDat}}.');
    expect(wordingProblem('[[ dated {{engagementDate}}')).toBe('Every [[ needs a matching ]].');
    expect(wordingProblem('  ')).toBe('The paragraph is empty.');
  });
});

describe('letterWording', () => {
  it('lays saved fixed lines over the defaults and ignores unknown keys', () => {
    const w = letterWording([
      { key: 'complimentary_close', kind: 'standard', body: 'Sincerely,' },
      { key: 'not-a-block', kind: 'standard', body: 'Ignored.' },
    ]);
    expect(w.standard.complimentary_close).toBe('Sincerely,');
    expect(w.standard.firm_line).toBe(STANDARD_BLOCKS.find((b) => b.key === 'firm_line')!.body);
    expect(Object.keys(w.standard)).not.toContain('not-a-block');
  });

  it('starts from the firm\'s paragraphs when none are given', () => {
    expect(letterWording().paragraphs.map((p) => p.key)).toEqual(DEFAULT_LETTER_PARAGRAPHS.map((p) => p.key));
  });
});
