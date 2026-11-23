import { describe, it, expect } from 'vitest';
import type { Trademark, TrademarkOfficeAction } from '@/types/notion';
import { trademarkNextStep, trademarkSteps, trademarkTracks } from './journey';

const TODAY = '2026-10-09';

function oa(id: string, mailingDate: string, p: Partial<TrademarkOfficeAction> = {}): TrademarkOfficeAction {
  return {
    id, trademarkId: 't', kind: 'office_action', title: null, mailingDate, receivedDate: null,
    respondBy: null, motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...p,
  };
}

function tm(p: Partial<Trademark>): Trademark {
  return {
    status: 'Pending',
    filingDate: null, noiDate: null, noiReceivedDate: null, noiPaymentDate: null, issuanceNoticeDate: null, issuanceNoticeReceivedDate: null, issuanceFeePaidDate: null,
    publishedDate: null, oppositionFiledDate: null, regDate: null, corReportedDate: null,
    localDeadlines: [], internationalRegistrations: [], officeActions: [],
    abandonmentMailingDate: null, abandonmentReceivedDate: null, revivalFiledDate: null,
    revivalDeclined: false, revivalCount: 0, statusBeforeAbandonment: null,
    dau3FilingDate: null, dau3Motex: false, dau3MotexDecision: null, dau3MotexDecidedOn: null, dau5FilingDate: null,
    renewalFilingDate: null, renewalDauFiledDate: null, renewalDau5FiledDate: null,
    ...p,
  } as unknown as Trademark;
}

describe('trademarkNextStep', () => {
  it('asks for the registration date when a registered mark has none', () => {
    // CNR: registered, an OA on record with no response, no registration date.
    const step = trademarkNextStep(
      tm({ status: 'Registered', filingDate: '2025-03-27', officeActions: [oa('a', '2025-05-29')], dau3FilingDate: '2025-03-28' }),
      TODAY,
    );
    expect(step.title).toBe('Record the registration date');
    expect(step.recordDate?.field).toBe('regDate');
    expect(step.actions).toEqual([]);
  });

  it('puts an overdue filing ahead of the missing registration date', () => {
    const step = trademarkNextStep(tm({ status: 'Registered', filingDate: '2023-01-01' }), TODAY);
    expect(step.title).toBe('Next: 3-DAU');
    expect(step.tone).toBe('overdue');
    expect(step.actions[0].action).toBe('dau_3_filed');
  });

  it('holds the action back until a filing window opens', () => {
    const step = trademarkNextStep(
      tm({ status: 'Registered', filingDate: '2024-01-01', dau3FilingDate: '2025-01-01', regDate: '2024-06-01' }),
      TODAY,
    );
    expect(step.title).toBe('Next: 5-DAU');
    expect(step.body).toMatch(/window opens/);
    expect(step.actions).toEqual([]);
  });

  it('lists other deadlines owed within the month under the main one', () => {
    const step = trademarkNextStep(tm({ officeActions: [oa('a', '2026-08-01')], issuanceNoticeDate: '2026-09-01' }), TODAY);
    expect(step.title).toBe('Respond to the Office Action');
    expect(step.alsoOwed.map((d) => d.label)).toEqual(['Issuance Fee']);
  });

  it('opens a second Office Action after the first is answered, with its own deadline', () => {
    const first = oa('a', '2026-03-01', { responseFiledDate: '2026-04-20' });
    const step = trademarkNextStep(tm({ status: 'Pending - OA', officeActions: [first, oa('b', '2026-09-15')] }), TODAY);
    expect(step.title).toBe('Respond to the Office Action 2');
    expect(step.due?.due).toBe('2026-11-15');
    expect(step.actions[0]).toMatchObject({ action: 'oa_response_filed', officeActionId: 'b' });
  });

  it('calls a final rejection what it is, and takes the examiner’s shorter period as it stands', () => {
    const step = trademarkNextStep(
      tm({ officeActions: [oa('a', '2026-09-20', { kind: 'final_rejection', respondBy: '2026-10-20' })] }),
      TODAY,
    );
    expect(step.title).toBe('Appeal or comply with the final rejection');
    expect(step.due).toMatchObject({ due: '2026-10-20', extendedDue: null });
    expect(step.actions.map((a) => a.action)).not.toContain('oa_response_motex');
  });

  it('offers the notice of abandonment once a response is overdue', () => {
    const step = trademarkNextStep(tm({ officeActions: [oa('a', '2026-06-01')] }), TODAY);
    expect(step.actions.map((a) => a.action)).toContain('abandonment_notice');
  });

  it('asks for nothing on allowance, offering the issuance fees in advance', () => {
    const step = trademarkNextStep(tm({ filingDate: '2026-02-13', noiDate: '2026-10-19' }), TODAY);
    expect(step.title).toBe('Allowed — waiting for publication');
    expect(step.due).toBeNull();
    expect(step.actions.map((a) => a.action)).toEqual(expect.arrayContaining(['published', 'issuance_paid']));
    expect(step.actions.find((a) => a.primary)?.action).toBe('published');
  });

  it('asks for the 1st publication fee on allowance of a filing before Feb 14, 2023', () => {
    const step = trademarkNextStep(tm({ filingDate: '2023-01-10', noiDate: '2026-10-19' }), TODAY);
    expect(step.title).toBe('Pay the 1st publication fee');
    expect(step.due?.due).toBe('2026-12-19');
  });

  it('counts the opposition period from publication, then waits for the Notice of Issuance', () => {
    const published = trademarkNextStep(tm({ noiDate: '2026-09-01', publishedDate: '2026-09-25' }), TODAY);
    expect(published.title).toBe('Published for opposition');
    expect(published.body).toContain('Oct 25, 2026');
    expect(published.expectedRegDate).toBe('2026-10-26');
    const after = trademarkNextStep(tm({ noiDate: '2026-08-01', publishedDate: '2026-08-15' }), TODAY);
    expect(after.title).toBe('Waiting for the Notice of Issuance');
    expect(after.actions.find((a) => a.primary)?.action).toBe('issuance_received');
  });

  it('asks for the issuance fees on the Notice of Issuance, then expects the COR', () => {
    const notice = trademarkNextStep(tm({ noiDate: '2026-07-01', publishedDate: '2026-08-15', issuanceNoticeDate: '2026-09-20' }), TODAY);
    expect(notice.title).toBe('Pay the issuance and 2nd publication fees');
    expect(notice.due?.due).toBe('2026-11-20');
    const paid = trademarkNextStep(tm({ noiDate: '2026-07-01', publishedDate: '2026-08-15', issuanceNoticeDate: '2026-09-20', issuanceFeePaidDate: '2026-09-25' }), TODAY);
    expect(paid.title).toBe('Waiting for the certificate of registration');
    expect(paid.actions.find((a) => a.action === 'cor_received')?.primary).toBe(true);
  });

  it('expects the COR straight after the opposition period when the fees were paid in advance', () => {
    const step = trademarkNextStep(tm({ noiDate: '2026-07-01', issuanceFeePaidDate: '2026-07-05', publishedDate: '2026-08-15' }), TODAY);
    expect(step.title).toBe('Waiting for the certificate of registration');
  });

  it('waits on the decision once an opposition is filed', () => {
    const step = trademarkNextStep(tm({ publishedDate: '2026-09-25', oppositionFiledDate: '2026-10-05' }), TODAY);
    expect(step.title).toBe('Opposed — waiting on the decision');
  });

  it('asks for the revival after a notice of abandonment, and stops once declined', () => {
    const notice = { status: 'Abandoned' as const, filingDate: '2026-01-10', abandonmentMailingDate: '2026-09-01' };
    const step = trademarkNextStep(tm(notice), TODAY);
    expect(step.title).toBe('Revive the application');
    expect(step.due?.due).toBe('2026-12-01');
    expect(step.actions.map((a) => a.action)).toEqual(['revival_filed', 'revival_declined']);
    expect(trademarkNextStep(tm({ ...notice, revivalDeclined: true }), TODAY).title).toBe('Abandoned');
  });
});

describe('trademarkSteps', () => {
  it('walks a pending mark through filing into examination', () => {
    const steps = trademarkSteps(tm({ filingDate: '2026-01-10' }), TODAY)!;
    expect(steps.map((s) => s.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(steps[0].sub).toBe('Filed Jan 10, 2026');
  });

  it('warns when the Office Action response is overdue', () => {
    const steps = trademarkSteps(tm({ filingDate: '2026-01-10', officeActions: [oa('a', '2026-06-01')] }), TODAY)!;
    expect(steps[1]).toMatchObject({ sub: 'Office Action response overdue', warn: true });
  });

  it('flags a registered mark with no registration date', () => {
    const steps = trademarkSteps(tm({ status: 'Registered', filingDate: '2025-03-27', dau3FilingDate: '2025-03-28' }), TODAY)!;
    expect(steps[2]).toMatchObject({ state: 'done', sub: 'Date not recorded', warn: true });
    expect(steps[3]).toMatchObject({ state: 'current', sub: 'Needs the registration date', warn: true });
  });

  it('shows no journey for an abandoned mark', () => {
    expect(trademarkSteps(tm({ status: 'Abandoned' }), TODAY)).toBeNull();
  });
});

describe('trademarkTracks', () => {
  it('shows prosecution alone while a quiet application is pending', () => {
    const tracks = trademarkTracks(tm({ filingDate: '2026-01-10' }), TODAY);
    expect(tracks.map((t) => t.key)).toEqual(['progress']);
    expect(tracks[0]).toMatchObject({ health: 'green', done: 2, total: 6 });
  });

  it('counts each Office Action round in the prosecution track', () => {
    const tracks = trademarkTracks(
      tm({ filingDate: '2026-01-10', officeActions: [oa('a', '2026-03-01', { responseFiledDate: '2026-04-01' }), oa('b', '2026-09-20')] }),
      TODAY,
    );
    expect(tracks[0]).toMatchObject({ done: 5, total: 10 });
  });

  it('brings upkeep forward when a 3-year DAU falls due mid-prosecution', () => {
    const tracks = trademarkTracks(tm({ filingDate: '2023-01-01' }), TODAY);
    expect(tracks.map((t) => [t.key, t.health])).toEqual([['progress', 'green'], ['upkeep', 'red']]);
  });

  it('shows upkeep alone once registered, amber while the date is missing', () => {
    const tracks = trademarkTracks(tm({ status: 'Registered', filingDate: '2025-03-27', dau3FilingDate: '2025-03-28' }), TODAY);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ key: 'upkeep', health: 'amber', summary: 'Registration date missing', done: 1, total: 1 });
  });
});
