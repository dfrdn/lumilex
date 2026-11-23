import { describe, expect, it } from 'vitest';
import { ilikeAnyFilter } from './search-filter';

describe('ilikeAnyFilter', () => {
  it('quotes the value so commas and parentheses stay inside it', () => {
    expect(ilikeAnyFilter(['name', 'status'], 'Smith, Inc. (PH)')).toBe(
      'name.ilike."%Smith, Inc. (PH)%",status.ilike."%Smith, Inc. (PH)%"',
    );
  });

  it('matches LIKE wildcards literally', () => {
    expect(ilikeAnyFilter(['name'], '50%_off')).toBe('name.ilike."%50\\\\%\\\\_off%"');
  });

  it('escapes quotes and backslashes for the quoted value', () => {
    expect(ilikeAnyFilter(['name'], 'a"b')).toBe('name.ilike."%a\\"b%"');
    expect(ilikeAnyFilter(['name'], 'a\\b')).toBe('name.ilike."%a\\\\\\\\b%"');
  });
});
