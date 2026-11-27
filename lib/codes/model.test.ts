import { describe, expect, it } from 'vitest';
import { describeChange, diffWords, latestChange, numberSortKey, provisionAnchor, provisionCitation, provisionHref, provisionLabel } from './model';

describe('provision identity', () => {
  it('cites in the style guide’s subsequent form, never abbreviating the code', () => {
    expect(provisionCitation('Labor Code', 'article', '237')).toBe('Labor Code, art. 237');
    expect(provisionCitation('Revised Corporation Code', 'section', '23')).toBe('Revised Corporation Code, sec. 23');
  });
  it('labels a renumbered article with its former number', () => {
    expect(provisionLabel('article', '237', '231')).toBe('Art. 237. [231]');
    expect(provisionLabel('section', '23')).toBe('Sec. 23.');
  });
  it('anchors and links by number', () => {
    expect(provisionAnchor('article', '266-A')).toBe('art-266-a');
    expect(provisionHref('labor', '237')).toBe('/dashboard/library/codes/labor/237');
  });
});

describe('numberSortKey', () => {
  it('orders inserted articles between their neighbours', () => {
    const order = ['267', '266-B', '266', '266-A'].sort((a, b) => numberSortKey(a) - numberSortKey(b));
    expect(order).toEqual(['266', '266-A', '266-B', '267']);
  });
});

describe('history', () => {
  it('reports the last change that reached a provision', () => {
    expect(latestChange([])).toBe('original');
    expect(latestChange([{ seq: 0, change: 'original' }, { seq: 2, change: 'renumbered' }, { seq: 1, change: 'amended' }])).toBe('renumbered');
  });
  it('describes a change with its law, section and approval date', () => {
    const fmt = (iso: string) => iso;
    expect(describeChange({ change: 'amended', instrument: 'Republic Act No. 6715', instrumentSection: 'sec. 3', approvedOn: '1989-03-02' }, fmt))
      .toBe('Amended by Republic Act No. 6715, sec. 3 (approved 1989-03-02)');
    expect(describeChange({ change: 'original', instrument: null, instrumentSection: null, approvedOn: null }, fmt)).toBe('As enacted');
  });
});

describe('diffWords', () => {
  it('marks the words a version added and removed', () => {
    const parts = diffWords('shall prescribe in ten years.', 'shall prescribe in fifteen years.');
    expect(parts).toEqual([
      { kind: 'same', text: 'shall prescribe in ' },
      { kind: 'removed', text: 'ten ' },
      { kind: 'added', text: 'fifteen ' },
      { kind: 'same', text: 'years.' },
    ]);
  });
  it('reads identical text as one unchanged run', () => {
    expect(diffWords('a b c', 'a b c')).toEqual([{ kind: 'same', text: 'a b c' }]);
  });
});
