import { describe, it, expect } from 'vitest';
import { asParagraphs, normalizeBlocks, subjectLine } from './engagement-proposal';

describe('subjectLine', () => {
  it('keeps the subject the model wrote, trimmed', () => {
    expect(subjectLine('  Engagement Proposal — Retainer Services for Acme, Inc. ', 'Acme, Inc.'))
      .toBe('Engagement Proposal — Retainer Services for Acme, Inc.');
  });

  it('falls back to the client name when the model leaves the subject out', () => {
    // The schema requires a non-empty subject; without this the whole draft is refused.
    expect(subjectLine(undefined, 'Acme, Inc.')).toBe('Engagement Proposal for Acme, Inc.');
    expect(subjectLine('   ', 'Acme, Inc.')).toBe('Engagement Proposal for Acme, Inc.');
    expect(subjectLine(42, 'Acme, Inc.')).toBe('Engagement Proposal for Acme, Inc.');
  });

  it('caps the subject at the schema limit', () => {
    expect(subjectLine('x'.repeat(500), 'Acme, Inc.')).toHaveLength(400);
  });
});

describe('asParagraphs', () => {
  it('passes an array of paragraphs through', () => {
    expect(asParagraphs(['first', 'second'])).toEqual(['first', 'second']);
  });

  it('wraps a bare string instead of letting it be iterated as characters', () => {
    // The renderer does `for (const para of content.intro)`. A string here
    // would render one paragraph per character.
    expect(asParagraphs('One long opening paragraph.')).toEqual(['One long opening paragraph.']);
  });

  it('drops blank and whitespace-only entries', () => {
    expect(asParagraphs(['real', '', '   ', 'also real'])).toEqual(['real', 'also real']);
  });

  it('returns an empty array for null, undefined, and objects', () => {
    expect(asParagraphs(undefined)).toEqual([]);
    expect(asParagraphs(null)).toEqual([]);
    expect(asParagraphs({ text: 'nope' })).toEqual([]);
    expect(asParagraphs('   ')).toEqual([]);
  });

  it('stringifies non-string array members rather than emitting them raw', () => {
    expect(asParagraphs([1, 'two'])).toEqual(['1', 'two']);
  });
});

describe('normalizeBlocks', () => {
  it('defaults an unrecognised kind with text to a paragraph', () => {
    expect(normalizeBlocks([{ kind: 'nonsense', text: 'body' }])).toEqual([
      { kind: 'para', text: 'body' },
    ]);
  });

  it('keeps a subheading only when it carries text', () => {
    expect(normalizeBlocks([{ kind: 'subheading', text: 'Retainer Services' }])).toEqual([
      { kind: 'subheading', text: 'Retainer Services' },
    ]);
    expect(normalizeBlocks([{ kind: 'subheading' }])).toEqual([]);
  });

  it('requires a label for a labelled block, falling back to a paragraph', () => {
    expect(normalizeBlocks([{ kind: 'labelled', label: 'Engagement and term', text: 'body' }])).toEqual([
      { kind: 'labelled', label: 'Engagement and term', text: 'body' },
    ]);
    expect(normalizeBlocks([{ kind: 'labelled', text: 'body' }])).toEqual([
      { kind: 'para', text: 'body' },
    ]);
  });

  it('treats a list as ordered unless told otherwise', () => {
    expect(normalizeBlocks([{ kind: 'list', items: ['a', 'b'] }])).toEqual([
      { kind: 'list', ordered: true, items: ['a', 'b'] },
    ]);
    expect(normalizeBlocks([{ kind: 'list', ordered: false, items: ['a'] }])).toEqual([
      { kind: 'list', ordered: false, items: ['a'] },
    ]);
  });

  it('drops a list with no items array rather than emitting an unusable block', () => {
    expect(normalizeBlocks([{ kind: 'list' }])).toEqual([]);
  });

  it('fills missing fee-table cells instead of emitting undefined', () => {
    expect(normalizeBlocks([{ kind: 'feeTable', rows: [{ fee: 'Initial Fee' }] }])).toEqual([
      { kind: 'feeTable', rows: [{ fee: 'Initial Fee', amount: '', when: '' }] },
    ]);
  });

  it('skips blocks that carry nothing renderable', () => {
    expect(normalizeBlocks([{ kind: 'para' }, {}])).toEqual([]);
  });

  it('handles an empty input', () => {
    expect(normalizeBlocks([])).toEqual([]);
  });
});
