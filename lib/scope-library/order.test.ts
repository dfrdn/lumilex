import { describe, it, expect } from 'vitest';
import { nextSortOrder } from './order';
import { DEFAULT_SCOPE_TEMPLATES } from './default';

const LAST = DEFAULT_SCOPE_TEMPLATES.length - 1;

describe('nextSortOrder', () => {
  it('keeps a shipped default at the position it has in code', () => {
    DEFAULT_SCOPE_TEMPLATES.forEach((t, i) => {
      expect(nextSortOrder(t.slug, [])).toBe(i);
    });
  });

  it('does not move a default to the front just because it was edited first', () => {
    // The bug this exists to stop: the first line a partner edits used to take
    // sort_order 0 and lead the catalogue in every proposal drafted after.
    const later = DEFAULT_SCOPE_TEMPLATES[DEFAULT_SCOPE_TEMPLATES.length - 1];
    expect(nextSortOrder(later.slug, [])).toBe(LAST);
    expect(nextSortOrder(later.slug, [])).not.toBe(0);
  });

  it('puts a line the firm added after every shipped default', () => {
    expect(nextSortOrder('bespoke-line', [])).toBe(LAST + 1);
  });

  it('puts a new line after the firm own additions too', () => {
    const rows = [{ sort_order: LAST + 1 }, { sort_order: LAST + 2 }];
    expect(nextSortOrder('another-line', rows)).toBe(LAST + 3);
  });

  it('is unmoved by saved rows that sit below the defaults', () => {
    expect(nextSortOrder('bespoke-line', [{ sort_order: 0 }, { sort_order: 2 }])).toBe(LAST + 1);
  });
});
