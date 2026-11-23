import { describe, expect, it } from 'vitest';
import type { Corporation } from '@/types/corporations';
import { planRollForward } from './roll-forward';
import { dueDate, dueDateInfo, fiscalYearOf, firstFiscalYear, obligationOfDeliverable, type FilingCalendarEntry } from './obligations';

function corp(p: Partial<Corporation> = {}): Corporation {
  return {
    id: 'c1',
    status: 'Active',
    proposedNames: [],
    approvedName: 'Acme Corp',
    secRegistrationDate: '2024-05-22',
    secRegistrationNo: 'CS2024050151981',
    fiscalYearEndMonth: 12,
    annualMeetingMonth: null,
    annualMeetingDay: null,
    handlesHousekeeping: true,
    isUnderRetainer: false,
    firmFiles: ['gis'],
    ...p,
  } as unknown as Corporation;
}

const filed = (type: string, name: string) => ({ type, name, externalDueDate: null, status: 'Filed or Sent out' });

describe('obligation dates', () => {
  it('numbers fiscal years by the year they end in', () => {
    expect(fiscalYearOf(corp(), '2026-10-09')).toBe(2026);
    expect(fiscalYearOf(corp({ fiscalYearEndMonth: 6 }), '2026-10-09')).toBe(2027);
    expect(firstFiscalYear(corp({ fiscalYearEndMonth: 6, secRegistrationDate: '2026-08-04' }))).toBe(2027);
  });

  it('dates the ITR the 15th day of the fourth month after year end', () => {
    expect(dueDate('itr', 2026, { corporation: corp() })).toBe('2027-04-15');
    expect(dueDate('itr', 2026, { corporation: corp({ fiscalYearEndMonth: 6 }) })).toBe('2026-10-15');
  });

  it('starts the GIS clock from the meeting actually held when there is one', () => {
    const c = corp({ annualMeetingMonth: 5, annualMeetingDay: 23 });
    expect(dueDate('gis', 2026, { corporation: c })).toBe('2027-06-22');
    expect(dueDate('gis', 2026, { corporation: c, heldAnnualMeeting: '2027-04-10' })).toBe('2027-05-10');
  });

  it('has no meeting due date without a by-laws date', () => {
    expect(dueDate('asm', 2026, { corporation: corp() })).toBeNull();
  });

  it('recognises the annual ITR but not the repealed 0605', () => {
    expect(obligationOfDeliverable({ type: 'BIR Filing', name: 'BIR 1702-RT (Annual Income Tax) — X (FY 2025)' })).toBe('itr');
    expect(obligationOfDeliverable({ type: 'BIR Filing', name: 'BIR 0605 (Annual Registration Fee) — X (2026)' })).toBeNull();
  });
});

describe('filing calendar', () => {
  const calendar: FilingCalendarEntry[] = [
    { obligation: 'afs', filingYear: 2026, dueDate: '2026-06-15', originalDueDate: '2026-05-29', digitSchedule: null, source: 'SEC MC 9-2026' },
    { obligation: 'itr', filingYear: 2026, dueDate: '2026-05-15', originalDueDate: '2026-04-15', digitSchedule: null, source: 'BIR' },
  ];

  it("uses the year's entry, extension included", () => {
    expect(dueDateInfo('afs', 2025, { corporation: corp(), calendar })).toMatchObject({ date: '2026-06-15', provisional: false });
    expect(dueDateInfo('itr', 2025, { corporation: corp(), calendar })).toMatchObject({ date: '2026-05-15', provisional: false });
  });

  it('projects the AFS from the date as first set, marked provisional', () => {
    expect(dueDateInfo('afs', 2026, { corporation: corp(), calendar })).toMatchObject({ date: '2027-05-29', provisional: true });
  });

  it('never carries an ITR extension forward', () => {
    expect(dueDateInfo('itr', 2026, { corporation: corp(), calendar })).toMatchObject({ date: '2027-04-15', provisional: false });
  });

  it('reads a schedule by registration digit', () => {
    const digits: FilingCalendarEntry[] = [
      { obligation: 'afs', filingYear: 2026, dueDate: null, digitSchedule: { '1': '04-30', '0': '06-30' }, source: null },
    ];
    expect(dueDate('afs', 2025, { corporation: corp(), calendar: digits })).toBe('2026-04-30');
    expect(dueDate('afs', 2025, { corporation: corp({ secRegistrationNo: 'CS2020' }), calendar: digits })).toBe('2026-06-30');
  });

  it('leaves non-December companies on the 120-day rule', () => {
    expect(dueDate('afs', 2026, { corporation: corp({ fiscalYearEndMonth: 6 }), calendar })).toBe('2026-10-28');
  });
});

describe('planRollForward', () => {
  const today = '2026-10-09';

  it('raises the next period still to fall due for each filing', () => {
    const plan = planRollForward(corp(), [], today);
    expect(plan.map((p) => [p.obligation, p.fy, p.dueDate])).toEqual([
      ['gis', 2026, '2027-01-30'],
    ]);
    expect(plan[0].name).toBe('SEC GIS — Acme Corp (2026)');
  });

  it('does not back-fill missed periods', () => {
    // FY 2025's filings fell due in 2026 and are already past.
    expect(planRollForward(corp(), [], today).every((p) => p.fy === 2026)).toBe(true);
  });

  it('leaves a period alone once it exists, in any status', () => {
    expect(planRollForward(corp(), [filed('SEC GIS', 'SEC GIS — Acme Corp (2026)')], today)).toEqual([]);
    expect(planRollForward(corp(), [
      { type: 'SEC GIS', name: 'SEC GIS — Acme Corp (2026)', externalDueDate: null, status: 'Archived' },
    ], today)).toEqual([]);
  });

  it('raises only the filings the firm files for the company', () => {
    expect(planRollForward(corp(), [], today).map((p) => p.obligation)).toEqual(['gis']);
    expect(planRollForward(corp({ firmFiles: ['gis', 'afs', 'itr'] }), [], today).map((p) => [p.obligation, p.dueDate])).toEqual([
      ['gis', '2027-01-30'],
      ['afs', '2027-04-30'], // SEC no. ends in 1
      ['itr', '2027-04-15'],
    ]);
    expect(planRollForward(corp({ firmFiles: ['afs'] }), [], today).map((p) => p.obligation)).toEqual(['afs']);
  });

  it('raises the GIS without housekeeping or a retainer when its switch is on', () => {
    expect(planRollForward(corp({ handlesHousekeeping: false }), [], today).map((p) => p.obligation)).toEqual(['gis']);
  });

  it('raises nothing for a company with no filings switched on, retainer or not', () => {
    expect(planRollForward(corp({ firmFiles: [], isUnderRetainer: true }), [], today)).toEqual([]);
  });

  it('raises nothing before registration or after dissolution', () => {
    expect(planRollForward(corp({ secRegistrationDate: null }), [], today)).toEqual([]);
    expect(planRollForward(corp({ status: 'Dissolved' }), [], today)).toEqual([]);
  });

  it('moves to the following year once a period falls due', () => {
    const plan = planRollForward(corp(), [], '2027-02-01');
    expect(plan.find((p) => p.obligation === 'gis')?.fy).toBe(2027);
  });
});
