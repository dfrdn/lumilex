import { describe, it, expect } from 'vitest';
import { computeYear1Deadlines, spawnComplianceDeliverables } from './corporation-deadlines';
import { dueDate } from '@/lib/corporations/obligations';
import type { Corporation } from '@/types/corporations';

// computeYear1Deadlines only reads a handful of fields; build minimal corps
// and cast through unknown.
function corp(p: Partial<Corporation> = {}): Corporation {
  return { proposedNames: [], firmFiles: ['gis'], ...p } as unknown as Corporation;
}

describe('computeYear1Deadlines', () => {
  it('returns nothing when the corp has no registration or incorporation date', () => {
    expect(computeYear1Deadlines(corp())).toEqual([]);
  });

  it('produces the year-1 deadlines for the filings the firm files', () => {
    const result = computeYear1Deadlines(
      corp({
        secRegistrationDate: '2026-03-15',
        secRegistrationNo: 'CS201900005',
        approvedName: 'Acme Corp',
      }),
    );
    expect(result.map((d) => [d.type, d.dueDate])).toEqual([
      ['SEC GIS', '2027-01-30'], // no by-laws meeting date → FY end Dec 31 + 30
    ]);
    const all = computeYear1Deadlines(
      corp({ secRegistrationDate: '2026-03-15', secRegistrationNo: 'CS201900005', firmFiles: ['gis', 'afs', 'itr'] }),
    );
    expect(all.map((d) => [d.type, d.dueDate])).toEqual([
      ['SEC GIS', '2027-01-30'],
      ['SEC AFS', '2027-05-30'], // staggered by reg-no last digit
      ['BIR Filing', '2027-04-15'],
    ]);
    expect(computeYear1Deadlines(corp({ secRegistrationDate: '2026-03-15', firmFiles: [] }))).toEqual([]);
  });

  it('does not generate a business permit deliverable', () => {
    // The firm files an application; the LGU issues the permit. There is no
    // work product, so the permit is a task — see lib/corporations/permit-task.
    const all = computeYear1Deadlines(
      corp({ secRegistrationDate: '2026-03-15', approvedName: 'Acme Corp' }),
    );
    expect(all.some((d) => /Permit/i.test(d.type) || /Permit/i.test(d.name))).toBe(false);
  });

  it('does not generate a BIR 0605 annual registration fee deliverable', () => {
    // RA 11976 §34 rewrote NIRC §236 and deleted the annual registration fee
    // subsection; the BIR stopped collecting it on 22 January 2024.
    const all = computeYear1Deadlines(
      corp({ secRegistrationDate: '2026-03-15', approvedName: 'Acme Corp' }),
    );
    expect(all.some((d) => /0605|Registration Fee/i.test(d.name))).toBe(false);
  });

  it('staggers the AFS deadline by the last digit of the SEC reg number', () => {
    const afs = (regNo: string | null) =>
      dueDate('afs', 2026, { corporation: corp({ secRegistrationDate: '2026-03-15', secRegistrationNo: regNo }) });
    expect(afs('CS-1')).toBe('2027-04-30'); // digit 1 → Apr 30
    expect(afs('CS-9')).toBe('2027-06-30'); // digit 9 → Jun 30
    expect(afs(null)).toBe('2027-06-30'); // no reg no → defaults to digit 0 → Jun 30
  });

  const gisFor = (p: Partial<Corporation>) =>
    computeYear1Deadlines(corp({ secRegistrationDate: '2026-03-15', ...p }))
      .find((d) => d.type === 'SEC GIS')!.dueDate;

  it('anchors the GIS deadline 30 days after the by-laws annual meeting', () => {
    // SEC MC 01-2025: within 30 calendar days of the annual meeting actually
    // held. RCC §49 puts that meeting on the by-laws date.
    expect(gisFor({ annualMeetingMonth: 6, annualMeetingDay: 15 })).toBe('2027-07-15');
  });

  it('picks the by-laws meeting that follows the fiscal year it reports on', () => {
    // FY ends 30 June 2026; a by-laws meeting on 15 September falls after it,
    // so the first GIS is due that year rather than the next.
    expect(gisFor({ fiscalYearEndMonth: 6, annualMeetingMonth: 9, annualMeetingDay: 15 }))
      .toBe('2026-10-15');
    // A March meeting date has already passed by the time FY 2026 closes, so
    // the meeting that reports on it is March 2027.
    expect(gisFor({ fiscalYearEndMonth: 6, annualMeetingMonth: 3, annualMeetingDay: 10 }))
      .toBe('2027-04-09');
  });

  it('clamps a by-laws day past the end of a short month', () => {
    // "the 31st of February" can't be filed against; February 2027 ends on 28.
    expect(gisFor({ annualMeetingMonth: 2, annualMeetingDay: 31 })).toBe('2027-03-30');
  });

  it('falls back to fiscal year-end + 30 when the by-laws date is incomplete', () => {
    expect(gisFor({ fiscalYearEndMonth: 6 })).toBe('2026-07-30'); // Jun 30 FY end + 30
    expect(gisFor({ fiscalYearEndMonth: 6, annualMeetingMonth: 9 })).toBe('2026-07-30');
    expect(gisFor({ fiscalYearEndMonth: 6, annualMeetingDay: 15 })).toBe('2026-07-30');
  });

  it('names deadlines using approved → first proposed → "Corporation"', () => {
    const named = (p: Partial<Corporation>) =>
      computeYear1Deadlines(corp({ secRegistrationDate: '2026-03-15', ...p }))[0].name;
    expect(named({ approvedName: 'Acme Corp' })).toContain('Acme Corp');
    expect(named({ approvedName: null, proposedNames: ['Beta Inc'] })).toContain('Beta Inc');
    expect(named({ approvedName: null, proposedNames: [] })).toContain('Corporation');
  });

  it('puts the corporation in every deadline name', () => {
    // Several corporations can share one billing matter, and the compliance
    // list groups by matter — a nameless "SEC GIS — 2026" appears once per
    // corporation with no way to tell whose is whose.
    const all = computeYear1Deadlines(
      corp({ secRegistrationDate: '2026-03-15', approvedName: 'Acme Corp' }),
    );
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) {
      expect(d.name).toContain('Acme Corp');
    }
  });

  it('keeps each deadline name unique within a corporation', () => {
    const all = computeYear1Deadlines(
      corp({ secRegistrationDate: '2026-03-15', approvedName: 'Acme Corp' }),
    );
    expect(new Set(all.map((d) => d.name)).size).toBe(all.length);
  });
});

describe('spawnComplianceDeliverables idempotency', () => {
  /**
   * Minimal stand-in for the Supabase client: records what would be inserted
   * and replays a canned set of already-present deliverables.
   */
  function fakeSupabase(existing: { type: string; external_due_date: string }[]) {
    const inserted: Record<string, unknown>[][] = [];
    const client = {
      from(table: string) {
        if (table === 'compliance_calendar') {
          return { select: () => ({ order: async () => ({ data: [] }) }) };
        }
        if (table === 'matters') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'M', client_name: 'C' } }) }) }),
          };
        }
        return {
          select: () => ({ like: async () => ({ data: existing }) }),
          insert: async (rows: Record<string, unknown>[]) => {
            inserted.push(rows);
            return { error: null };
          },
        };
      },
    };
    return { client, inserted };
  }

  const registered = corp({
    secRegistrationDate: '2025-03-20',
    approvedName: 'Acme Corp',
    retainerMatterId: 'matter-1',
    isUnderRetainer: true,
  });

  it('spawns the full set on a first run', async () => {
    const { client, inserted } = fakeSupabase([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = await spawnComplianceDeliverables(registered, client as any, 'firm-1', 'user-1');
    expect(n).toBeGreaterThan(0);
    expect(inserted[0]).toHaveLength(n);
    // firm_id is stamped explicitly: one caller passes the authed client, which
    // does not inject it, and the column has no default.
    expect(inserted[0].every((r: Record<string, unknown>) => r.firm_id === 'firm-1')).toBe(true);
  });

  it('spawns nothing on a second run', async () => {
    // Both the "already incorporated" POST branch and the SEC-approval chain
    // call this, and a corporation can go through both.
    const all = computeYear1Deadlines(registered).map((d) => ({
      type: d.type,
      external_due_date: d.dueDate,
    }));
    const { client, inserted } = fakeSupabase(all);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = await spawnComplianceDeliverables(registered, client as any, 'firm-1', 'user-1');
    expect(n).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('still raises the GIS when an AFS or ITR is already on the board', async () => {
    const { client } = fakeSupabase([{ type: 'SEC AFS', external_due_date: '2026-05-30' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = await spawnComplianceDeliverables(registered, client as any, 'firm-1', 'user-1');
    expect(n).toBe(computeYear1Deadlines(registered).length);
  });
});
