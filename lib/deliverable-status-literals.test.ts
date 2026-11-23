import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findStatusLiterals, evaluateStatusLiterals } from './deliverable-status-literals';

describe('findStatusLiterals', () => {
  it('finds a bare status in a comparison, an array and a JSX attribute', () => {
    const src = `
      if (d.status === 'Archived') {}
      const done = ['Filed or Sent out', "Acknowledged"];
      const el = <Pill status="Outbox" />;
    `;
    expect(findStatusLiterals(src).map((h) => h.literal)).toEqual([
      'Archived', 'Filed or Sent out', 'Acknowledged', 'Outbox',
    ]);
  });

  it('reports the line of each hit', () => {
    expect(findStatusLiterals("\n\nconst s = 'Drafting';")).toEqual([{ literal: 'Drafting', line: 3 }]);
  });

  it('ignores comments, longer strings and template text', () => {
    const src = `
      // status 'Archived' means abandoned
      /* 'Filed or Sent out' */
      const msg = 'Moved to Archived';
      const t = \`is "\${s}", expected "Pre-finalized"\`;
    `;
    expect(findStatusLiterals(src)).toEqual([]);
  });

  it('reads each item of a PostgREST in-list', () => {
    const src = `q.not('status', 'in', '("Filed or Sent out","Archived")')`;
    expect(findStatusLiterals(src).map((h) => h.literal)).toEqual(['Filed or Sent out', 'Archived']);
  });

  it('catches a no-substitution template literal', () => {
    expect(findStatusLiterals('const s = `Outbox`;').map((h) => h.literal)).toEqual(['Outbox']);
  });

  it('is case-exact: other entities\' casing is not the deliverable value', () => {
    expect(findStatusLiterals("const t = 'Not Started';")).toEqual([]);
  });
});

describe('evaluateStatusLiterals', () => {
  const hits = { 'a.ts': [{ literal: 'Archived', line: 1 }, { literal: 'Archived', line: 9 }] };

  it('fails an unlisted literal', () => {
    const r = evaluateStatusLiterals(hits, {});
    expect(r.violations).toEqual([{ file: 'a.ts', literal: 'Archived', lines: [1, 9], allowed: 0 }]);
  });

  it('passes a literal within its allowance', () => {
    const r = evaluateStatusLiterals(hits, { 'a.ts': { Archived: { count: 2, reason: 'matters.status' } } });
    expect(r.violations).toEqual([]);
  });

  it('is a ratchet: one more literal in an allowlisted file still fails', () => {
    const r = evaluateStatusLiterals(hits, { 'a.ts': { Archived: { count: 1, reason: 'matters.status' } } });
    expect(r.violations).toHaveLength(1);
  });

  it('reports an allowance larger than what the file holds', () => {
    const r = evaluateStatusLiterals(hits, { 'a.ts': { Archived: { count: 3, reason: 'matters.status' } } });
    expect(r.stale).toEqual([{ file: 'a.ts', literal: 'Archived', allowed: 3, found: 2 }]);
  });
});

describe('negative control on real code', () => {
  it('flags the drifted set this gate exists for, as it stood before the vocabulary', () => {
    // app/api/notifications/generate/route.ts before phase 0: three statuses
    // no deliverable holds, and the one that mattered — Filed or Sent out —
    // missing, so deadline reminders fired for filed work. Only 'Archived' is
    // real vocabulary; the gate must still see it.
    const before = `.not('status', 'in', '("Completed","Filed","Cancelled","Archived")')`;
    expect(findStatusLiterals(before).map((h) => h.literal)).toEqual(['Archived']);
    const withLiteral = `if (status !== 'Archived' && status !== 'Filed or Sent out') {}`;
    expect(findStatusLiterals(withLiteral).map((h) => h.literal)).toEqual(['Archived', 'Filed or Sent out']);
  });

  it('the vocabulary module is the only file allowed to spell the statuses', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'deliverable-status.ts'), 'utf8');
    expect(findStatusLiterals(src, 'deliverable-status.ts').length).toBeGreaterThanOrEqual(12);
  });
});
