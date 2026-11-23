import { describe, it, expect } from 'vitest';
import { buildFilingHistory, yearOf, isFiled, filedYears, type FilingDeliverable } from './filing-history';
import type { CorporationFile } from '@/types/corporations';

let n = 1;
const deliv = (over: Partial<FilingDeliverable> = {}): FilingDeliverable => ({
  notionId: `d${n++}`,
  name: 'SEC GIS — Acme Corp (2025)',
  type: 'SEC GIS',
  externalDueDate: '2026-01-30',
  status: 'Not started',
  ...over,
});

const file = (over: Partial<CorporationFile> = {}): CorporationFile =>
  ({ id: n++, category: 'GIS', filingYear: 2025, name: 'gis.pdf', ...over }) as CorporationFile;

describe('yearOf', () => {
  it('reads the year out of a generated name', () => {
    expect(yearOf(deliv({ name: 'SEC GIS — Acme Corp (2025)' }))).toBe(2025);
    expect(yearOf(deliv({ name: 'SEC AFS — Acme Corp (FY 2024)' }))).toBe(2024);
  });

  it('falls back to the due date, which is the year after the one covered', () => {
    expect(yearOf(deliv({ name: 'SEC GIS', externalDueDate: '2026-01-30' }))).toBe(2025);
  });

  it('gives up rather than guessing', () => {
    expect(yearOf(deliv({ name: 'SEC GIS', externalDueDate: null }))).toBeNull();
  });
});

describe('isFiled', () => {
  it('recognises the statuses that mean done', () => {
    expect(isFiled('Filed or Sent out')).toBe(true);
    // Never deliverable statuses; the old set carried them as legacy spellings.
    for (const s of ['Submitted', 'Done', 'Completed']) expect(isFiled(s)).toBe(false);
  });
  it('treats everything else as outstanding', () => {
    for (const s of ['Not started', 'Under Review', '', null, undefined]) expect(isFiled(s)).toBe(false);
  });
});

describe('buildFilingHistory', () => {
  it('joins the obligation to its filed document on year', () => {
    const rows = buildFilingHistory(
      [deliv({ status: 'Filed or Sent out' })],
      [file({ filingYear: 2025 })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'GIS', year: 2025, status: 'Filed or Sent out' });
    expect(rows[0].documents).toHaveLength(1);
    expect(rows[0].filedWithoutDocument).toBe(false);
  });

  it('flags an obligation marked filed with nothing attached', () => {
    // Marking a deliverable done never required uploading the copy, so this is
    // the common real-world gap.
    const rows = buildFilingHistory([deliv({ status: 'Filed or Sent out' })], []);
    expect(rows[0].filedWithoutDocument).toBe(true);
  });

  it('flags a document for a year nobody raised an obligation for', () => {
    const rows = buildFilingHistory([], [file({ filingYear: 2019 })]);
    expect(rows[0]).toMatchObject({ year: 2019, documentWithoutObligation: true, status: null });
  });

  it('keeps GIS and AFS on separate rows for the same year', () => {
    const rows = buildFilingHistory(
      [deliv({ name: 'SEC GIS — Acme (2025)' }), deliv({ name: 'SEC AFS — Acme (FY 2025)', type: 'SEC AFS' })],
      [],
    );
    expect(rows.map((r) => r.kind).sort()).toEqual(['AFS', 'GIS']);
  });

  it('prefers the acted-on deliverable when a year was double-spawned', () => {
    const rows = buildFilingHistory(
      [
        deliv({ notionId: 'first', status: 'Not started' }),
        deliv({ notionId: 'second', status: 'Filed or Sent out' }),
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deliverableId).toBe('second');
  });

  it('ignores non-reportorial deliverables and untagged documents', () => {
    const rows = buildFilingHistory(
      [deliv({ type: 'BIR Filing', name: 'BIR 0605 — Acme (2026)' })],
      [file({ category: 'AOI' }), file({ category: 'GIS', filingYear: null })],
    );
    expect(rows).toEqual([]);
  });

  it('orders most recent first', () => {
    const rows = buildFilingHistory(
      [
        deliv({ name: 'SEC GIS — Acme (2023)' }),
        deliv({ name: 'SEC GIS — Acme (2025)' }),
        deliv({ name: 'SEC GIS — Acme (2024)' }),
      ],
      [],
    );
    expect(rows.map((r) => r.year)).toEqual([2025, 2024, 2023]);
  });

  it('reports which years are already filed', () => {
    const rows = buildFilingHistory(
      [
        deliv({ name: 'SEC GIS — Acme (2024)', status: 'Filed or Sent out' }),
        deliv({ name: 'SEC GIS — Acme (2025)', status: 'Not started' }),
      ],
      [],
    );
    expect([...filedYears(rows, 'GIS')]).toEqual([2024]);
  });
});
