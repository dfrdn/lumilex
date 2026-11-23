import { describe, it, expect } from 'vitest';
import { isKeywordEligible, mergeExactFirst, stripHeadlineMarkers, KEYWORD_QUERY_MAX_CHARS } from './knowledge-merge';

describe('isKeywordEligible', () => {
  it('accepts short typed phrases and rejects pasted briefs', () => {
    expect(isKeywordEligible('special power of attorney')).toBe(true);
    expect(isKeywordEligible('"motion to resolve" richdale')).toBe(true);
    expect(isKeywordEligible('a')).toBe(false);
    expect(isKeywordEligible('   ')).toBe(false);
    expect(isKeywordEligible('x'.repeat(KEYWORD_QUERY_MAX_CHARS + 1))).toBe(false);
  });
});

describe('stripHeadlineMarkers', () => {
  it('removes the RPC markers and collapses whitespace', () => {
    expect(stripHeadlineMarkers('the «Special» «Power» of\n  Attorney executed')).toBe('the Special Power of Attorney executed');
  });
});

describe('mergeExactFirst', () => {
  it('puts exact hits first and drops semantic duplicates', () => {
    const exact = [{ key: 'a', from: 'exact' }, { key: 'b', from: 'exact' }];
    const semantic = [{ key: 'b', from: 'semantic' }, { key: 'c', from: 'semantic' }, { key: 'a', from: 'semantic' }];
    expect(mergeExactFirst(exact, semantic)).toEqual([
      { key: 'a', from: 'exact' },
      { key: 'b', from: 'exact' },
      { key: 'c', from: 'semantic' },
    ]);
  });

  it('dedupes within the exact list too', () => {
    const exact = [{ key: 'a' }, { key: 'a' }];
    expect(mergeExactFirst(exact, [])).toEqual([{ key: 'a' }]);
  });

  it('returns the semantic list untouched when there are no exact hits', () => {
    const semantic = [{ key: 'x' }, { key: 'y' }];
    expect(mergeExactFirst([], semantic)).toEqual(semantic);
  });
});
