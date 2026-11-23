import { describe, expect, it } from 'vitest';
import { DEFAULT_LETTER_PARAGRAPHS, FACTS, describeRule, paragraphKey, paragraphShows, readParagraphs, readRule, type BillingParagraph, type Facts } from './paragraphs';
import { wordingProblem } from './letter-blocks';

const none = Object.fromEntries(FACTS.map((f) => [f.key, false])) as Facts;
const para = (over: Partial<BillingParagraph>): BillingParagraph => ({
  key: 'p', document: 'letter', label: 'P', body: 'Body.', rule: [], choice: null, system: null, sortOrder: 0, archived: false, ...over,
});

describe('readRule', () => {
  it('keeps known facts once and drops anything malformed', () => {
    expect(readRule([{ fact: 'vat', is: true }, { fact: 'vat', is: false }, { fact: 'nope', is: true }, { fact: 'discount' }, 'x'])).toEqual([{ fact: 'vat', is: true }]);
    expect(readRule(null)).toEqual([]);
  });
});

describe('readParagraphs', () => {
  it('returns one document\'s live paragraphs in order', () => {
    const row = { label: null, body: '', rule: [], choice: null, system: null, archived: false };
    const out = readParagraphs([
      { ...row, key: 'b', document: 'letter', sort_order: 20 },
      { ...row, key: 'a', document: 'letter', sort_order: 10, system: 'deposit' },
      { ...row, key: 'gone', document: 'letter', sort_order: 5, archived: true },
      { ...row, key: 'e', document: 'email', sort_order: 1 },
    ], 'letter');
    expect(out.map((p) => [p.key, p.label, p.system])).toEqual([['a', 'a', 'deposit'], ['b', 'b', null]]);
  });
});

describe('paragraphShows', () => {
  it('holds every term of the rule', () => {
    const p = para({ rule: [{ fact: 'payable', is: true }, { fact: 'bankDetails', is: false }] });
    expect(paragraphShows(p, { ...none, payable: true }, [])).toBe(true);
    expect(paragraphShows(p, { ...none, payable: true, bankDetails: true }, [])).toBe(false);
    expect(paragraphShows(p, none, [])).toBe(false);
  });

  it('needs a client choice to be ticked', () => {
    const p = para({ choice: 'arrangement' });
    expect(paragraphShows(p, none, [])).toBe(false);
    expect(paragraphShows(p, none, ['arrangement'])).toBe(true);
  });

  it('shows an app-worded paragraph only when it has something to say', () => {
    expect(paragraphShows(para({ system: 'deposit' }), none, [])).toBe(false);
    expect(paragraphShows(para({ system: 'deposit' }), { ...none, moneyOnHand: true }, [])).toBe(true);
  });
});

describe('describeRule', () => {
  it('reads the rule in finance\'s terms', () => {
    expect(describeRule(para({}))).toBe('Every time');
    expect(describeRule(para({ rule: [{ fact: 'vat', is: true }, { fact: 'overCap', is: false }], choice: 'x' }), 'Arrangement'))
      .toBe('When ticked for the client (Arrangement); billed with VAT; not: the hours went over the retainer cap');
  });
});

describe('paragraphKey', () => {
  it('slugs the name and steers clear of keys in use', () => {
    expect(paragraphKey('Offer a Payment Arrangement!', new Set())).toBe('offer-a-payment-arrangement');
    expect(paragraphKey('Closing', new Set(['closing', 'closing-2']))).toBe('closing-3');
    expect(paragraphKey('!!!', new Set())).toBe('paragraph');
  });
});

describe('DEFAULT_LETTER_PARAGRAPHS', () => {
  it('are all valid wording', () => {
    for (const p of DEFAULT_LETTER_PARAGRAPHS) if (!p.system) expect(wordingProblem(p.body), p.key).toBeNull();
  });
});
