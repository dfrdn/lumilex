import { describe, it, expect } from 'vitest';
import {
  rollUpSeverity,
  adverseQueries,
  reconcileCitations,
  jurisAvailability,
  matchVerdictsToTargets,
  mergeCoverage,
  type RedTeamFinding,
  type ModelCitationVerdict,
  type TargetPoint,
} from './red-team';

function finding(severity: RedTeamFinding['severity']): RedTeamFinding {
  return {
    category: 'procedural',
    severity,
    confidence: 'high',
    heading: 'h',
    location: '',
    our_text: '',
    is_omission: false,
    attack: 'a',
    authority: '',
    fix: '',
    argument_line: '',
  };
}

describe('rollUpSeverity', () => {
  it('counts each severity', () => {
    const out = rollUpSeverity([
      finding('critical'), finding('high'), finding('high'), finding('low'),
    ]);
    expect(out).toEqual({ critical: 1, high: 2, medium: 0, low: 1 });
  });

  it('returns all-zero for no findings', () => {
    expect(rollUpSeverity([])).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  it('ignores a severity the model invented', () => {
    const bogus = { ...finding('high'), severity: 'catastrophic' } as unknown as RedTeamFinding;
    expect(rollUpSeverity([bogus, finding('low')])).toEqual({
      critical: 0, high: 0, medium: 0, low: 1,
    });
  });
});

describe('adverseQueries', () => {
  const prop = (proposition: string, contrary_query: string) => ({
    proposition, why_it_matters: '', supporting_citations: [], contrary_query,
  });

  it('drops propositions with no contrary query', () => {
    const out = adverseQueries([prop('a', 'query a'), prop('b', '   '), prop('c', 'query c')]);
    expect(out.map((p) => p.contrary_query)).toEqual(['query a', 'query c']);
  });

  it('dedupes case-insensitively and trims', () => {
    const out = adverseQueries([
      prop('a', 'prescription ran from registration'),
      prop('b', '  Prescription Ran From Registration  '),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].contrary_query).toBe('prescription ran from registration');
  });

  it('caps the number of searches fired at the free service', () => {
    const many = Array.from({ length: 12 }, (_, i) => prop(`p${i}`, `q${i}`));
    expect(adverseQueries(many)).toHaveLength(4);
    expect(adverseQueries(many, 2)).toHaveLength(2);
  });
});

describe('reconcileCitations', () => {
  it('normalizes the model\'s loose citation format to the canonical lookup form', () => {
    const out = reconcileCitations([{ citation: 'GR No. 188611', offered_for: 'warrantless search' }], '');
    expect(out).toEqual([{ ref: 'G.R. No. 188611', kind: 'case', offered_for: 'warrantless search' }]);
  });

  it('collapses the model\'s citation and the regex sweep into one target', () => {
    const out = reconcileCitations(
      [{ citation: 'G.R. No. 188611', offered_for: 'warrantless search' }],
      'As held in G.R. No. 188611, the search was invalid.',
    );
    expect(out).toHaveLength(1);
    // Recon wins the dedupe so the "cited for" context survives.
    expect(out[0].offered_for).toBe('warrantless search');
  });

  it('picks up citations the model missed', () => {
    const out = reconcileCitations(
      [{ citation: 'G.R. No. 188611', offered_for: 'warrantless search' }],
      'See G.R. No. 188611 and RA 9165, and also A.M. No. P-03-1726.',
    );
    expect(out.map((c) => c.ref)).toContain('RA 9165');
    expect(out.map((c) => c.ref)).toContain('A.M. No. P-03-1726');
    expect(out.find((c) => c.ref === 'RA 9165')?.kind).toBe('ra');
    // Sweep-only hits carry no proposition context.
    expect(out.find((c) => c.ref === 'RA 9165')?.offered_for).toBe('');
  });

  it('skips references that are not juris.ph records', () => {
    const out = reconcileCitations(
      [{ citation: 'Rule 65, Rules of Court', offered_for: 'certiorari' }],
      '',
    );
    expect(out).toEqual([]);
  });

  // Verified live: juris.ph answers not_found for these, so cite-checking them
  // would flag the Rules of Court as unverifiable in every single pleading.
  it('does not cite-check Supreme Court issuances (A.M. …-SC)', () => {
    const out = reconcileCitations(
      [{ citation: 'A.M. No. 12-8-8-SC', offered_for: 'the Judicial Affidavit Rule' }],
      'Under A.M. No. 19-08-15-SC (2019 Revised Rules on Evidence), the testimony is hearsay.',
    );
    expect(out).toEqual([]);
  });

  it('still cite-checks disciplinary administrative matters and cases', () => {
    const out = reconcileCitations([], 'See A.M. No. P-03-1726 and A.C. No. 9269.');
    expect(out.map((c) => c.ref)).toEqual(['A.M. No. P-03-1726', 'A.C. No. 9269']);
  });

  it('caps the number of lookups', () => {
    const text = Array.from({ length: 20 }, (_, i) => `G.R. No. ${100000 + i}`).join(', ');
    expect(reconcileCitations([], text)).toHaveLength(8);
    expect(reconcileCitations([], text, 3)).toHaveLength(3);
  });

  it('tolerates a missing recon list and empty text', () => {
    expect(reconcileCitations([], '')).toEqual([]);
  });
});

describe('matchVerdictsToTargets', () => {
  const v = (ref: string, note = 'n'): ModelCitationVerdict => ({ ref, verdict: 'mismatch', note });

  it('matches however loosely the model reformatted the citation', () => {
    // reconcileCitations produces "G.R. No. 188611"; the model echoes it loosely.
    for (const echoed of ['G.R. No. 188611', 'G.R. 188611', 'GR No. 188611', 'G.R. No. 188611 (2010)']) {
      const m = matchVerdictsToTargets(['G.R. No. 188611'], [v(echoed)]);
      expect(m.get('G.R. No. 188611'), echoed).toBeDefined();
    }
  });

  it('matches statutes too', () => {
    expect(matchVerdictsToTargets(['RA 9165'], [v('Republic Act No. 9165')]).get('RA 9165')).toBeDefined();
  });

  it('keeps verdicts attached to the right target when several are in play', () => {
    const m = matchVerdictsToTargets(
      ['G.R. No. 188611', 'RA 9165'],
      [v('RA 9165', 'statute note'), v('G.R. 188611', 'case note')],
    );
    expect(m.get('RA 9165')?.note).toBe('statute note');
    expect(m.get('G.R. No. 188611')?.note).toBe('case note');
  });

  it('leaves an ambiguous digit signature unmatched rather than guessing', () => {
    // Attaching the wrong holding to a citation is worse than "unclear".
    const m = matchVerdictsToTargets(
      ['G.R. No. 9165'],
      [v('9165'), v('9165')],
    );
    expect(m.get('G.R. No. 9165')).toBeUndefined();
  });

  it('does not match a target the model said nothing about', () => {
    const m = matchVerdictsToTargets(['G.R. No. 188611', 'RA 9165'], [v('G.R. No. 188611')]);
    expect(m.get('RA 9165')).toBeUndefined();
  });

  // A malformed entry must not take a completed Opus analysis down with it.
  it('skips entries with a missing or non-string ref instead of throwing', () => {
    const bad = [
      { verdict: 'supports', note: '' },
      { ref: null, verdict: 'supports', note: '' },
      v('G.R. No. 188611'),
    ] as unknown as ModelCitationVerdict[];
    const m = matchVerdictsToTargets(['G.R. No. 188611'], bad);
    expect(m.size).toBe(1);
    expect(m.get('G.R. No. 188611')).toBeDefined();
  });

  it('tolerates an undefined list and an empty target list', () => {
    expect(matchVerdictsToTargets(['G.R. No. 188611'], undefined).size).toBe(0);
    expect(matchVerdictsToTargets([], [v('G.R. No. 188611')]).size).toBe(0);
  });
});

describe('jurisAvailability', () => {
  // The distinction this encodes is the one that matters most in the whole
  // feature: an outage must never be rendered as "we checked and found nothing".
  it('is null when juris.ph was never asked anything', () => {
    expect(jurisAvailability(0, 0)).toBeNull();
  });

  it('is false when every lookup failed transport', () => {
    expect(jurisAvailability(5, 0)).toBe(false);
  });

  it('is true when at least one lookup got through', () => {
    expect(jurisAvailability(5, 1)).toBe(true);
    expect(jurisAvailability(5, 5)).toBe(true);
  });
});

describe('mergeCoverage', () => {
  const point = (ref: string, text: string, requires_response = true): TargetPoint => ({
    ref, kind: 'allegation', text, requires_response,
  });

  it('seeds a row from every point that requires a response', () => {
    const out = mergeCoverage(
      [point('¶ 5', 'the loan was never paid'), point('¶ 6', 'demand was made')],
      [{ ref: '¶ 5', status: 'addressed', note: '' }, { ref: '¶ 6', status: 'missing', note: 'no denial' }],
    );
    expect(out.map((c) => [c.ref, c.status])).toEqual([['¶ 5', 'addressed'], ['¶ 6', 'missing']]);
  });

  it('drops formal recitals that need no response', () => {
    const out = mergeCoverage(
      [point('¶ 1', 'plaintiff is of legal age', false), point('¶ 5', 'the loan was never paid')],
      [],
    );
    expect(out.map((c) => c.ref)).toEqual(['¶ 5']);
  });

  it('matches refs the model reformatted', () => {
    const out = mergeCoverage(
      [point('¶ 12', 'title was fraudulently obtained'), point('Ground II', 'the action has prescribed')],
      [
        { ref: 'Paragraph 12', status: 'partial', note: 'negative pregnant' },
        { ref: 'ground ii', status: 'missing', note: 'not met' },
      ],
    );
    expect(out.map((c) => c.status)).toEqual(['partial', 'missing']);
  });

  // The point of seeding from their pleading: an allegation the analysis never
  // mentions still shows up, and shows up as unchecked rather than as a gap we
  // are asserting exists.
  it('reports a point the model said nothing about as unclear, never missing', () => {
    const out = mergeCoverage([point('¶ 9', 'the goods were defective')], []);
    expect(out[0].status).toBe('unclear');
    expect(out[0].note).toMatch(/did not report/i);
  });

  it('does not let one verdict claim two points with the same ref', () => {
    const out = mergeCoverage(
      [point('¶ 7', 'first allegation'), point('¶ 7', 'second allegation')],
      [{ ref: '¶ 7', status: 'addressed', note: '' }],
    );
    expect(out.map((c) => c.status)).toEqual(['addressed', 'unclear']);
  });

  it('survives a malformed coverage entry and an empty ref', () => {
    const out = mergeCoverage(
      [point('', 'an allegation with no paragraph number')],
      [null as never, { ref: '¶ 3', status: 'addressed', note: '' }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('unclear');
  });

  it('returns nothing when there is no target', () => {
    expect(mergeCoverage([], undefined)).toEqual([]);
  });
});
