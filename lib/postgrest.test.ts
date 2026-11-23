import { describe, it, expect } from 'vitest';
import { pgInList } from './postgrest';

describe('pgInList', () => {
  it('quotes every value, so spaces survive', () => {
    expect(pgInList(['Filed or Sent out', 'Archived'])).toBe('("Filed or Sent out","Archived")');
  });
  it('escapes an embedded quote', () => {
    expect(pgInList(['a"b'])).toBe('("a\\"b")');
  });
});
