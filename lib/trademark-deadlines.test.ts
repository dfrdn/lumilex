import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  noiDeadline,
  oaResponseDeadline,
  oaResponseOwed,
  oppositionPeriod,
  revivalDeadline,
  dau3Deadline,
  dau5Period,
  renewalPeriod,
  renewalDauPeriod,
  renewalDau5Period,
  refNo,
  upcomingDeadlines,
  nextDeliverable,
  allDeadlinesForDashboard,
  type DashboardTrademarkInput,
  type ClientReportRow,
} from './trademark-deadlines';
import type { Trademark } from '@/types/notion';

afterEach(() => {
  vi.useRealTimers();
});

describe('date-math deadline helpers', () => {
  it('noiDeadline adds 2 months and is not extendible', () => {
    // Publication + issuance fees fall due 2 months from the Notice of
    // Allowance / Issuance. The firm treats NOA and NOI as one event.
    expect(noiDeadline('2026-01-15')).toEqual({
      opens: null, due: '2026-03-15', extendedDue: null, extensionBasis: null,
    });
  });

  it('oaResponseDeadline adds 2 months to the mailing date, extendible by 2 more', () => {
    expect(oaResponseDeadline({ mailingDate: '2026-01-15', respondBy: null })).toEqual({
      opens: null, due: '2026-03-15', extendedDue: '2026-05-15', extensionBasis: 'request',
    });
  });

  it('oaResponseOwed is due on the extended date once the extension is filed', () => {
    expect(oaResponseOwed({ mailingDate: '2026-01-15', respondBy: null, motex: true, motexDecision: null })).toEqual({
      opens: null, due: '2026-05-15', extendedDue: null, extensionBasis: null,
    });
    expect(oaResponseOwed({ mailingDate: '2026-01-15', respondBy: null, motex: false, motexDecision: null }).due).toBe('2026-03-15');
  });

  it('takes an examiner’s shorter period as it stands, with no routine extension', () => {
    // Rule 612 — a period under 4 months is extended only for good cause.
    expect(oaResponseDeadline({ mailingDate: '2026-01-15', respondBy: '2026-02-14' })).toEqual({
      opens: null, due: '2026-02-14', extendedDue: null, extensionBasis: null,
    });
  });

  it('revival runs 3 months from the notice of abandonment and is not extendible', () => {
    // Rule 611.
    expect(revivalDeadline('2026-08-20')).toEqual({ opens: null, due: '2026-11-20', extendedDue: null, extensionBasis: null });
    expect(revivalDeadline(null)).toBeNull();
  });

  it('the opposition period ends 30 days after publication; registration follows the next day', () => {
    // Rule 703.
    expect(oppositionPeriod('2026-09-25')).toEqual({ ends: '2026-10-25', deemedRegistered: '2026-10-26' });
  });

  it('rolls the year over when months overflow December', () => {
    expect(noiDeadline('2026-11-15')?.due).toBe('2027-01-15');
  });

  it('dau3 runs 3 years from the filing date, extendible by 6 months', () => {
    // IP Code s. 124.2 — anchored on filing, not registration.
    expect(dau3Deadline('2026-01-15')).toEqual({
      opens: null, due: '2029-01-15', extendedDue: '2029-07-15', extensionBasis: 'request',
    });
  });

  it('dau5 runs one year from the 5th anniversary of REGISTRATION', () => {
    // IP Code s. 145 — the window opens at reg + 5yr and closes at reg + 6yr.
    // Anchoring this on the filing date (the pre-2026-08 behaviour) fired the
    // deadline roughly a year early, since registration trails filing.
    expect(dau5Period('2026-01-15')).toEqual({
      opens: '2031-01-15', due: '2032-01-15', extendedDue: null, extensionBasis: null,
    });
  });

  it('dau5 is not extendible, unlike dau3', () => {
    expect(dau5Period('2026-01-15')?.extendedDue).toBeNull();
    expect(dau3Deadline('2026-01-15')?.extendedDue).not.toBeNull();
  });

  it('renewal spans 6 months either side of the 10-year expiry', () => {
    // IP Code s. 146.2 — filed 6 months before expiry, or 6 months after on
    // payment of the surcharge.
    expect(renewalPeriod('2020-06-30')).toEqual({
      opens: '2029-12-30', due: '2030-06-30', extendedDue: '2030-12-30', extensionBasis: 'surcharge',
    });
  });

  it('renewal DAU runs one year from the date of renewal, fileable from 6 months before expiry', () => {
    // Rule 204(c), Rule 206. The renewed term begins when the previous one
    // expires (reg + 10yr), not when the renewal request was filed.
    expect(renewalDauPeriod('2020-06-30')).toEqual({
      opens: '2029-12-30', due: '2031-06-30', extendedDue: null, extensionBasis: null,
    });
  });

  it('renewal 5-DAU runs one year from the 5th anniversary of renewal', () => {
    expect(renewalDau5Period('2020-06-30')).toEqual({
      opens: '2035-06-30', due: '2036-06-30', extendedDue: null, extensionBasis: null,
    });
  });

  it('neither renewal DAU is extendible', () => {
    expect(renewalDauPeriod('2020-06-30')?.extendedDue).toBeNull();
    expect(renewalDau5Period('2020-06-30')?.extendedDue).toBeNull();
  });

  it('handles a Feb-29 anchor landing on a non-leap year', () => {
    expect(dau3Deadline('2024-02-29')?.due).toBe('2027-03-01');
    expect(dau5Period('2024-02-29')).toEqual({
      opens: '2029-03-01', due: '2030-03-01', extendedDue: null, extensionBasis: null,
    });
  });

  it('returns null for null inputs', () => {
    expect(noiDeadline(null)).toBeNull();
    expect(dau5Period(null)).toBeNull();
    expect(renewalPeriod(null)).toBeNull();
  });
});

describe('refNo', () => {
  it('zero-pads the client index and trims the reg number', () => {
    expect(refNo({ clientCode: 12, clientIndex: 3, country: 'PH', regIrNo: '  4/2020/123  ' })).toBe('12-03-PH-4/2020/123');
  });

  it('tolerates missing parts', () => {
    expect(refNo({ clientCode: null, clientIndex: 0, country: '', regIrNo: null })).toBe('-00--');
  });
});

// upcomingDeadlines / nextDeliverable read the big Notion Trademark type; build
// just the lifecycle fields they use.
function tm(p: Partial<Trademark>): Trademark {
  return { localDeadlines: [], internationalRegistrations: [], officeActions: [], ...p } as unknown as Trademark;
}

const round = (id: string, mailingDate: string, p: Partial<Trademark['officeActions'][number]> = {}) =>
  ({ id, trademarkId: 't', kind: 'office_action' as const, title: null, mailingDate, receivedDate: null, respondBy: null, motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...p });

describe('upcomingDeadlines', () => {
  it('lists pending deadlines sorted by date ascending', () => {
    const result = upcomingDeadlines(
      tm({
        issuanceNoticeDate: '2026-01-01',
        filingDate: '2026-01-01',
        officeActions: [round('a', '2025-12-01')],
      }),
    );
    expect(result.map((d) => d.label)).toEqual(['OA Response', 'Issuance Fee', '3-DAU']);
    expect(result.map((d) => d.due)).toEqual(['2026-02-01', '2026-03-01', '2029-01-01']);
  });

  it('closes the NOI payment and OA response once the mark is registered', () => {
    const open = { filingDate: '2025-01-01', issuanceNoticeDate: '2025-05-09', officeActions: [round('a', '2025-05-29')] };
    expect(upcomingDeadlines(tm({ ...open, regDate: '2025-08-01' })).map((d) => d.label))
      .not.toEqual(expect.arrayContaining(['Issuance Fee']));
    expect(upcomingDeadlines(tm({ ...open, regDate: '2025-08-01' })).map((d) => d.label))
      .not.toContain('OA Response');
    // Registered on record but no registration date entered yet.
    expect(upcomingDeadlines(tm({ ...open, status: 'Registered' })).map((d) => d.label)).toEqual(['3-DAU']);
  });

  it('carries the window opening and extension through to each entry', () => {
    const result = upcomingDeadlines(tm({ regDate: '2020-01-01' }));
    expect(result).toEqual([
      { label: '5-DAU', opens: '2025-01-01', due: '2026-01-01', extendedDue: null, extensionBasis: null },
      { label: 'Renewal', opens: '2029-07-01', due: '2030-01-01', extendedDue: '2030-07-01', extensionBasis: 'surcharge' },
    ]);
  });

  it('omits the 5-DAU for a filed-but-unregistered mark', () => {
    // The obligation is anchored on registration, so it does not exist yet.
    const result = upcomingDeadlines(tm({ filingDate: '2026-01-01' }));
    expect(result.map((d) => d.label)).toEqual(['3-DAU']);
  });

  it('skips deadlines that have already been satisfied', () => {
    const result = upcomingDeadlines(
      tm({
        issuanceNoticeDate: '2026-01-01',
        issuanceFeePaidDate: '2026-02-01',   // fees paid
        filingDate: '2026-01-01',
        dau3FilingDate: '2029-01-05',   // 3-DAU done
        regDate: '2020-01-01',
        renewalFilingDate: '2030-01-02',    // renewal done
        renewalDauFiledDate: '2030-06-01',  // and both of its declarations
        renewalDau5FiledDate: '2035-06-01',
      }),
    );
    expect(result.map((d) => d.label)).toEqual(['5-DAU']);
  });

  it('raises no renewal DAUs until the renewal has been filed', () => {
    // A registered-but-unrenewed mark owes the renewal itself, nothing after it.
    const result = upcomingDeadlines(tm({ regDate: '2020-01-01', dau5FilingDate: '2025-06-01' }));
    expect(result.map((d) => d.label)).toEqual(['Renewal']);
  });

  it('swaps the renewal for its two declarations once renewal is filed', () => {
    const result = upcomingDeadlines(
      tm({ regDate: '2020-01-01', dau5FilingDate: '2025-06-01', renewalFilingDate: '2029-11-01' }),
    );
    expect(result.map((d) => [d.label, d.opens, d.due])).toEqual([
      ['Renewal DAU', '2029-07-01', '2031-01-01'],
      ['Renewal 5-DAU', '2035-01-01', '2036-01-01'],
    ]);
  });

  it('drops each renewal declaration as it is filed', () => {
    const result = upcomingDeadlines(
      tm({
        regDate: '2020-01-01',
        dau5FilingDate: '2025-06-01',
        renewalFilingDate: '2029-11-01',
        renewalDauFiledDate: '2030-03-01',
      }),
    );
    expect(result.map((d) => d.label)).toEqual(['Renewal 5-DAU']);
  });

  it('returns an empty list when nothing is pending', () => {
    expect(upcomingDeadlines(tm({}))).toEqual([]);
  });
});

describe('fees on allowance', () => {
  it('owes nothing on a Notice of Allowance for a filing from Feb 14, 2023', () => {
    expect(upcomingDeadlines(tm({ filingDate: '2026-02-13', noiDate: '2026-10-19' })).map((d) => d.label)).toEqual(['3-DAU']);
  });

  it('owes the 1st publication fee within 2 months on an earlier filing', () => {
    const owed = upcomingDeadlines(tm({ filingDate: '2023-02-13', noiDate: '2026-10-19' }));
    expect(owed.find((d) => d.label === '1st Publication Fee')?.due).toBe('2026-12-19');
    expect(upcomingDeadlines(tm({ filingDate: '2023-02-13', noiDate: '2026-10-19', noiPaymentDate: '2026-10-25' })).map((d) => d.label))
      .not.toContain('1st Publication Fee');
  });

  it('owes nothing on the Notice of Issuance when the fees were paid in advance', () => {
    expect(upcomingDeadlines(tm({ filingDate: '2026-02-13', issuanceNoticeDate: '2026-11-01', issuanceFeePaidDate: '2026-10-20' })).map((d) => d.label))
      .toEqual(['3-DAU']);
  });
});

describe('nextDeliverable', () => {
  it('returns the earliest deadline still owed', () => {
    const next = nextDeliverable(tm({ issuanceNoticeDate: '2026-02-01', filingDate: '2026-01-01' }));
    // issuance fees due 2026-04-01 beats the 3-DAU 2029-01-01
    expect(next).toEqual({ label: 'Issuance Fee', opens: null, due: '2026-04-01', extendedDue: null, extensionBasis: null });
  });

  it('puts an overdue deadline ahead of later ones rather than hiding it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    // OA received in June and never answered; the 3-DAU is years off.
    const next = nextDeliverable(tm({ filingDate: '2025-05-26', officeActions: [round('a', '2026-06-08')] }));
    expect(next?.label).toBe('OA Response');
  });

  it('returns null when there are no deadlines', () => {
    expect(nextDeliverable(tm({}))).toBeNull();
  });
});

// DashboardTrademarkInput is a concrete interface — build a full base.
function dashTM(p: Partial<DashboardTrademarkInput> = {}): DashboardTrademarkInput {
  return {
    id: 'tm-1',
    mark: 'ACME',
    type: null,
    classes: [],
    status: 'Pending',
    matterId: null,
    matterName: '',
    clientId: null,
    clientName: '',
    clientCode: null,
    clientIndex: 0,
    country: 'PH',
    contactEmail: null,
    markImagePath: null,
    regIrNo: null,
    origin: 'national',
    localDeadlines: [],
    internationalRegistrations: [],
    irDate: null,
    designationDate: null,
    dau5DueDate: null,
    renewalDueDate: null,
    renewalDauDueDate: null,
    renewalDau5DueDate: null,
    filingDate: null,
    noiDate: null,
    noiPaymentDate: null,
    issuanceNoticeDate: null,
    issuanceFeePaidDate: null,
    officeActions: [],
    abandonmentMailingDate: null,
    revivalFiledDate: null,
    revivalDeclined: false,
    regDate: null,
    dau3FilingDate: null,
    dau3Motex: false, dau3MotexDecision: null,
    dau5FilingDate: null,
    renewalFilingDate: null,
    renewalDauFiledDate: null,
    renewalDau5FiledDate: null,
    ...p,
  };
}

describe('allDeadlinesForDashboard', () => {
  it('flattens pending deadlines with urgency buckets and sorts by due date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));

    const trademarks = [
      dashTM({ id: 'a', regDate: '2016-03-04', dau5FilingDate: '2021-06-01' }), // renewal due 2026-03-04 (3 days out)
      dashTM({ id: 'b', issuanceNoticeDate: '2026-03-01' }), // issuance fees due 2026-05-01 (~61 days out)
    ];
    const result = allDeadlinesForDashboard(trademarks, []);

    expect(result.map((d) => [d.trademark.id, d.kind, d.due])).toEqual([
      ['a', 'Renewal', '2026-03-04'],
      ['b', 'Issuance Fee', '2026-05-01'],
    ]);
    expect(result[0].daysRemaining).toBe(3);
    expect(result[0].urgency).toBe('due_this_week');
    expect(result[1].urgency).toBe('due_within_90');
  });

  it('marks overdue deadlines and skips Abandoned trademarks with nothing to revive', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));

    const result = allDeadlinesForDashboard(
      [
        dashTM({ id: 'live', issuanceNoticeDate: '2026-01-01' }), // due 2026-03-01 → overdue
        dashTM({ id: 'dead', status: 'Abandoned', issuanceNoticeDate: '2026-01-01' }),
      ],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].trademark.id).toBe('live');
    expect(result[0].urgency).toBe('overdue');
    expect(result[0].daysRemaining).toBeLessThan(0);
  });

  it('keeps an abandoned mark on the board while its revival is open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    const result = allDeadlinesForDashboard(
      [dashTM({ id: 'dead', status: 'Abandoned', abandonmentMailingDate: '2026-08-20' })],
      [],
    );
    expect(result.map((d) => [d.kind, d.due])).toEqual([['Revival', '2026-11-20']]);
  });

  it('carries each open round on its own deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    const result = allDeadlinesForDashboard(
      [dashTM({ id: 'a', officeActions: [round('r1', '2026-03-01', { responseFiledDate: '2026-04-01' }), round('r2', '2026-08-10')] })],
      [],
    );
    expect(result.map((d) => [d.kind, d.due, d.officeAction?.id])).toEqual([['OA Response', '2026-10-10', 'r2']]);
  });

  it('skips deadlines that are already satisfied', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    const result = allDeadlinesForDashboard(
      [dashTM({ id: 'a', issuanceNoticeDate: '2026-01-01', issuanceFeePaidDate: '2026-02-01' })],
      [],
    );
    expect(result).toEqual([]);
  });

  it('anchors the 5-DAU on registration and flags a window that has not opened', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));

    // Filed 2024-01-10, registered 2025-02-20. Anchoring on the filing date
    // would have put the 5-DAU at 2029-01-10; the real bar date is 2031-02-20.
    const [dau5] = allDeadlinesForDashboard(
      [dashTM({ id: 'a', filingDate: '2024-01-10', regDate: '2025-02-20', renewalFilingDate: '2035-01-01' })],
      [],
    ).filter((d) => d.kind === '5-DAU');

    expect(dau5.opens).toBe('2030-02-20');
    expect(dau5.due).toBe('2031-02-20');
    expect(dau5.extendedDue).toBeNull();
    expect(dau5.notYetOpen).toBe(true);
    expect(dau5.urgency).toBe('future');
  });

  it('does not raise a 5-DAU for a mark that is filed but not yet registered', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    const result = allDeadlinesForDashboard([dashTM({ id: 'a', filingDate: '2020-01-01' })], []);
    expect(result.map((d) => d.kind)).toEqual(['3-DAU']);
  });

  it('reports the extension bar date for the deadlines that are extendible', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    const result = allDeadlinesForDashboard([dashTM({ id: 'a', officeActions: [round('r', '2026-02-10')] })], []);
    expect(result[0]).toMatchObject({
      kind: 'OA Response',
      opens: null,
      due: '2026-04-10',
      extendedDue: '2026-06-10',
      extensionBasis: 'request',
      notYetOpen: false,
    });
  });

  it('surfaces both renewal declarations on the dashboard once renewed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-03-01T00:00:00Z'));

    const result = allDeadlinesForDashboard(
      [dashTM({
        id: 'a',
        regDate: '2020-01-01',
        dau5FilingDate: '2025-06-01',
        renewalFilingDate: '2029-11-01',
      })],
      [],
    );

    expect(result.map((d) => [d.kind, d.due, d.notYetOpen])).toEqual([
      ['Renewal DAU', '2031-01-01', false],   // window opened 2029-07-01
      ['Renewal 5-DAU', '2036-01-01', true],  // opens 2035-01-01
    ]);
  });

  it('joins the most recent matching client report onto each deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));

    const reports: ClientReportRow[] = [
      { trademarkId: 'a', deadlineKind: 'Renewal', deadlineDue: '2026-03-04', sentAt: '2026-02-01T00:00:00Z', sentBy: 'u1', recipientEmail: 'x@y.com' },
      { trademarkId: 'a', deadlineKind: 'Renewal', deadlineDue: '2026-03-04', sentAt: '2026-02-10T00:00:00Z', sentBy: 'u2', recipientEmail: 'x@y.com' },
    ];
    const result = allDeadlinesForDashboard([dashTM({ id: 'a', regDate: '2016-03-04', dau5FilingDate: '2021-06-01' })], reports);
    expect(result[0].lastReport?.sentBy).toBe('u2'); // newest by sentAt wins
  });
});

describe('extension decisions', () => {
  it('keeps the extended date while pending or granted, and puts the original back on a denial', () => {
    const base = { mailingDate: '2026-01-15', respondBy: null, motex: true };
    expect(oaResponseOwed({ ...base, motexDecision: null }).due).toBe('2026-05-15');
    expect(oaResponseOwed({ ...base, motexDecision: 'granted' }).due).toBe('2026-05-15');
    expect(oaResponseOwed({ ...base, motexDecision: 'denied' })).toMatchObject({ due: '2026-03-15', extendedDue: '2026-05-15' });
  });

  it('does the same for the 3-year DAU', () => {
    const filed = { filingDate: '2023-02-01', dau3Motex: true };
    const due = (decision: 'granted' | 'denied' | null) =>
      upcomingDeadlines(tm({ ...filed, dau3MotexDecision: decision })).find((d) => d.label === '3-DAU')!;
    expect(due(null)).toMatchObject({ due: '2026-08-01', extension: 'pending' });
    expect(due('granted')).toMatchObject({ due: '2026-08-01', extension: 'granted' });
    expect(due('denied')).toMatchObject({ due: '2026-02-01', extension: 'denied' });
  });

  it('tags an Office Action response with where its extension stands', () => {
    const [pending] = upcomingDeadlines(tm({ filingDate: '2026-01-01', officeActions: [round('a', '2026-06-01', { motex: true })] }));
    expect(pending).toMatchObject({ label: 'OA Response', extension: 'pending' });
    const [none] = upcomingDeadlines(tm({ filingDate: '2026-01-01', officeActions: [round('a', '2026-06-01')] }));
    expect(none.extension).toBeUndefined();
  });
});
