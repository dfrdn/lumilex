import { describe, it, expect } from 'vitest';
import { scanSource, isAllowedToken, ALLOWED_TOKENS } from './person-shaped';

/**
 * The two cases below are the point of the whole module: they reconstruct the
 * two constants that shipped in `lib/` and passed every green `verify:brand`
 * run, in the same shape with stand-in initials and figures (the real ones are
 * not published). If either stops being flagged, the gate is decorative.
 */
describe('the constants that actually shipped', () => {
  it('flags partner profit shares keyed by initials', () => {
    // The shape of the deleted lib/evaluations/partner-shares.ts.
    const src = `
export const PARTNER_PROFIT_SHARES: Record<string, number> = {
  ADC: 0.40,
  BEL: 0.30,
  CMR: 0.15,
  DNP: 0.10,
  EOS: 0.05,
};`;
    const tokens = scanSource(src).map((h) => h.token).sort();
    expect(tokens).toEqual(['ADC', 'BEL', 'CMR', 'DNP', 'EOS']);
    expect(scanSource(src).every((h) => h.position === 'key-to-number')).toBe(true);
  });

  it("flags a person's initials as a string-union member", () => {
    // The lowercase case. An initials-shaped /^[A-Z]{2,4}$/ rule misses this,
    // which is why the rule is case-insensitive and position-based instead.
    const src = `      bonusProfile: (row.bonus_profile ?? 'standard') as 'standard' | 'qzx',`;
    const hits = scanSource(src);
    expect(hits.map((h) => h.token)).toEqual(['qzx']);
    expect(hits[0].position).toBe('union-member');
    expect(hits[0].line).toBe(1);
  });

  it('would flag a newly-added partner without an allowlist edit', () => {
    expect(scanSource('  RJT: 0.2,').map((h) => h.token)).toEqual(['RJT']);
  });
});

describe('the allowlist', () => {
  it('lets the real vocabulary through', () => {
    // A line of each shape built only from allowlisted tokens.
    expect(scanSource("  size: 12,\n  top: 4,")).toEqual([]);
    expect(scanSource("type Status = 'done' | 'idle' | 'past';")).toEqual([]);
  });

  it('passes agency acronyms that look exactly like initials', () => {
    // The reason the gate cannot decide for itself: same shape, different kind.
    for (const t of ['bir', 'bsp', 'doj', 'sec', 'GIS', 'TIN']) {
      expect(isAllowedToken(t)).toBe(true);
    }
    expect(isAllowedToken('qzx')).toBe(false);
  });

  it('has no duplicate entries across groups', () => {
    const all = Object.values(ALLOWED_TOKENS).flat();
    expect(all.length).toBe(new Set(all).size);
  });

  it('is grouped — every entry carries a reason by living in a named group', () => {
    for (const [group, tokens] of Object.entries(ALLOWED_TOKENS)) {
      expect(group).toMatch(/^[a-z_]+$/);
      expect(tokens.length).toBeGreaterThan(0);
    }
  });
});

describe('scanning', () => {
  it('reports the line number and the source line', () => {
    const hits = scanSource("const a = 1;\nconst shares = { ZZZ: 0.5 };");
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
    expect(hits[0].text).toBe('const shares = { ZZZ: 0.5 };');
  });

  it('does not re-report the same token twice on one line', () => {
    expect(scanSource("{ QQQ: 1, QQQ: 2 }")).toHaveLength(1);
  });

  it('ignores tokens longer than four characters', () => {
    // Initials run 2–4. A longer opaque token is a word, an id, or a slug —
    // out of scope here, and catching them would drown the signal.
    expect(scanSource('  ABCDE: 0.5,')).toEqual([]);
  });

  it('ignores a bare long-form name — this gate is only about short tokens', () => {
    expect(scanSource("const partner = 'Juan Dela Cruz';")).toEqual([]);
  });
});
