import { describe, expect, it } from 'vitest';
import { dayCountsIn, parseRuleCitations, ruleSectionAnchor, rulesPartSlug, sectionHref, sourceOfRule, titleCase } from './model';

describe('sourceOfRule', () => {
  it('maps rule numbers to the three publications and nothing else', () => {
    expect(sourceOfRule(15)).toBe('civil');
    expect(sourceOfRule(71)).toBe('civil');
    expect(sourceOfRule(72)).toBeNull();
    expect(sourceOfRule(112)).toBe('criminal');
    expect(sourceOfRule(132)).toBe('evidence');
  });
});

describe('parseRuleCitations', () => {
  it('reads Rule/Section pairs in either order and de-duplicates', () => {
    expect(parseRuleCitations('Rule 37, Sec. 1; Rule 52, Sec. 1')).toEqual([
      { source: 'civil', rule: 37, section: 1 },
      { source: 'civil', rule: 52, section: 1 },
    ]);
    expect(parseRuleCitations('Section 34, Rule 132 of the Rules on Evidence')).toEqual([{ source: 'evidence', rule: 132, section: 34 }]);
    expect(parseRuleCitations('Rule 41, Sec. 3, 2019 Amended Rules')).toEqual([{ source: 'civil', rule: 41, section: 3 }]);
  });
  it('falls back to the rule alone when no section is named', () => {
    expect(parseRuleCitations('Rule 65')).toEqual([{ source: 'civil', rule: 65, section: null }]);
  });
  it('ignores other rule books', () => {
    expect(parseRuleCitations('NLRC Rules, Rule VI, Sec. 1; Labor Code Art. 229')).toEqual([]);
    expect(parseRuleCitations('CTA Rules, Rule 6, Sec. 3')).toEqual([]);
    expect(parseRuleCitations('Rule on Summary Procedure, Sec. 5')).toEqual([]);
    expect(parseRuleCitations('Rule 65, Sec. 4; St. Martin Funeral Homes doctrine')).toEqual([{ source: 'civil', rule: 65, section: 4 }]);
  });
});

describe('dayCountsIn', () => {
  it('finds the parenthesised day counts', () => {
    expect(dayCountsIn('within fifteen (15) calendar days from notice, or thirty (30) days where a record on appeal is required, not five (5) years')).toEqual([15, 30]);
  });
});

describe('titleCase and anchors', () => {
  it('title-cases a rule heading', () => {
    expect(titleCase('MOTION FOR RECONSIDERATION')).toBe('Motion for Reconsideration');
    expect(titleCase('PRE-TRIAL')).toBe('Pre-Trial');
  });
  it('anchors a section by its rule, since section numbers repeat across a book', () => {
    expect(ruleSectionAnchor(15, 5)).toBe('rule-15-sec-5');
    expect(rulesPartSlug('evidence')).toBe('rules-of-court-evidence');
    expect(sectionHref('civil', 41, 3)).toBe('/dashboard/library/rules/civil/41?section=3');
  });
});
