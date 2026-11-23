import { describe, it, expect } from 'vitest';
import type { Trademark, TrademarkOfficeAction } from '@/types/notion';
import { pendingDeadlines } from '@/lib/trademark-deadlines';
import { trademarkNextStep, trademarkSteps, upkeepRows } from './journey';
import { designationStartingPoint } from './create';
import { buildExtensionRequest, extensionProblems } from './extension-request';
import { reportableEvents } from './client-report';
import { madridFields } from '@/lib/trademark-row';

const TODAY = '2026-10-30';

function refusal(id: string, mailingDate: string, p: Partial<TrademarkOfficeAction> = {}): TrademarkOfficeAction {
  return {
    id, trademarkId: 't', kind: 'provisional_refusal', title: null, mailingDate, receivedDate: null,
    respondBy: '2026-12-15', motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...p,
  };
}

/** A designation of the Philippines in international registration 1234567. */
function designation(p: Partial<Trademark> = {}): Trademark {
  return {
    id: 't', mark: 'SAMPLE', origin: 'madrid_in', regIrNo: '1234567', irDate: '2025-02-10', designationDate: null, classes: [25],
    status: 'Pending', filingDate: null, noiDate: null, noiPaymentDate: null, issuanceNoticeDate: null, issuanceFeePaidDate: null,
    publishedDate: null, oppositionFiledDate: null, regDate: null, corReportedDate: null, localDeadlines: [], internationalRegistrations: [], officeActions: [],
    abandonmentMailingDate: null, revivalFiledDate: null, revivalDeclined: false, revivalCount: 0,
    dau3FilingDate: null, dau3Motex: false, dau3MotexDecision: null, dau3MotexDecidedOn: null, dau5FilingDate: null, renewalFilingDate: null, renewalDauFiledDate: null, renewalDau5FiledDate: null,
    dau5DueDate: null, renewalDueDate: null, renewalDauDueDate: null, renewalDau5DueDate: null,
    ...p,
  } as unknown as Trademark;
}

describe('designation deadlines', () => {
  it('counts the 3-year DAU from the international registration, extendible by six months', () => {
    const [dau] = pendingDeadlines(designation());
    expect(dau).toMatchObject({ kind: '3-DAU', due: '2028-02-10', extendedDue: '2028-08-10', extensionBasis: 'request' });
  });

  it('is due on the extended date once the extension is filed', () => {
    const [dau] = pendingDeadlines(designation({ dau3Motex: true, dau3MotexDecision: null, dau3MotexDecidedOn: null }));
    expect(dau).toMatchObject({ kind: '3-DAU', due: '2028-08-10', extendedDue: null });
  });

  it('counts it from a later designation of the Philippines instead', () => {
    expect(pendingDeadlines(designation({ designationDate: '2025-09-01' }))[0]).toMatchObject({ kind: '3-DAU', due: '2028-09-01' });
  });

  it('owes no IPOPHL fees, and answers a refusal by the date on its notice', () => {
    const owed = pendingDeadlines(designation({ status: 'Pending - OA', issuanceNoticeDate: '2026-09-01', officeActions: [refusal('r', '2026-10-01')] }));
    expect(owed.map((d) => d.kind)).toEqual(['OA Response', '3-DAU']);
    expect(owed[0]).toMatchObject({ due: '2026-12-15', extendedDue: null });
  });

  it('tracks the later upkeep only once its due date is entered', () => {
    const granted = designation({ status: 'Registered', regDate: '2026-03-01', dau3FilingDate: '2026-04-01' });
    expect(pendingDeadlines(granted)).toEqual([]);
    expect(pendingDeadlines({ ...granted, dau5DueDate: '2031-03-01' })).toMatchObject([{ kind: '5-DAU', due: '2031-03-01', opens: null }]);
  });
});

describe('designation journey', () => {
  it('offers a refusal, publication and the grant while under examination', () => {
    const step = trademarkNextStep(designation(), TODAY);
    expect(step.title).toBe('Under examination');
    expect(step.actions.map((a) => a.action)).toEqual(['oa_received', 'published', 'protection_granted']);
    expect(step.actions[0]).toMatchObject({ roundKinds: ['provisional_refusal', 'final_rejection'], respondByRequired: true });
  });

  it('asks for the response to a provisional refusal, with no MOTEX', () => {
    const step = trademarkNextStep(designation({ status: 'Pending - OA', officeActions: [refusal('r', '2026-10-01')] }), TODAY);
    expect(step.title).toBe('Respond to the provisional refusal');
    expect(step.due?.due).toBe('2026-12-15');
    expect(step.actions.map((a) => a.action)).not.toContain('oa_response_motex');
  });

  it('asks for the 5-year DAU due date once protection is granted', () => {
    const step = trademarkNextStep(designation({ status: 'Registered', regDate: '2026-03-01', dau3FilingDate: '2026-04-01' }), TODAY);
    expect(step.recordDate).toEqual({ field: 'dau5DueDate', label: '5-year DAU due date', dateLabel: 'Due on' });
  });

  it('names its steps for a designation', () => {
    const steps = trademarkSteps(designation({ publishedDate: '2026-08-01' }), TODAY)!;
    expect(steps.map((s) => [s.label, s.sub])).toEqual([
      ['Designation', 'Designated Feb 10, 2025'],
      ['Examination', 'Done'],
      ['Protection', 'Published Aug 1, 2026'],
      ['Upkeep', 'DAUs and renewal'],
    ]);
  });

  it('marks the later upkeep rows as entered by hand', () => {
    const rows = upkeepRows(designation({ status: 'Registered', regDate: '2026-03-01' }));
    expect(rows.map((r) => [r.key, r.dueField])).toEqual([['3dau', null], ['5dau', 'dau5DueDate'], ['renewal', 'renewalDueDate']]);
  });
});

describe('designationStartingPoint', () => {
  it('starts a designation with its international registration', () => {
    expect(designationStartingPoint({ stage: 'examination', irNo: ' 1234567 ', irDate: '2025-02-10' }, TODAY)).toEqual({
      row: { origin: 'madrid_in', status: 'Pending', reg_ir_no: '1234567', ir_date: '2025-02-10', designation_date: null, dau_3_filing_date: null },
      officeAction: null,
    });
  });

  it('records an open refusal with the response date on its notice', () => {
    const r = designationStartingPoint({ stage: 'refusal', irDate: '2025-02-10', refusalMailingDate: '2026-10-01', refusalRespondBy: '2026-12-15' }, TODAY);
    expect(r).toMatchObject({
      row: { status: 'Pending - OA' },
      officeAction: { kind: 'provisional_refusal', mailing_date: '2026-10-01', respond_by: '2026-12-15' },
    });
  });

  it('refuses dates that do not hold together', () => {
    expect(designationStartingPoint({ stage: 'examination' }, TODAY)).toEqual({ error: expect.stringMatching(/international registration date/) });
    expect(designationStartingPoint({ stage: 'examination', irDate: '2025-02-10', designationDate: '2025-01-01' }, TODAY))
      .toEqual({ error: expect.stringMatching(/before the international registration/) });
    expect(designationStartingPoint({ stage: 'refusal', irDate: '2025-02-10', refusalMailingDate: '2026-10-01' }, TODAY))
      .toEqual({ error: expect.stringMatching(/response date/) });
    expect(designationStartingPoint({ stage: 'registered', irDate: '2025-02-10', grantDate: '2025-01-01' }, TODAY))
      .toEqual({ error: expect.stringMatching(/before the Philippines was designated/) });
  });
});

describe('designation papers', () => {
  it('captions the extension request with the international registration', () => {
    const text = buildExtensionRequest(designation({ designationDate: '2025-09-01' }), { purpose: 'oa_response', reasons: ['complexity'] }, {
      today: TODAY, signatory: { name: 'Juan dela Cruz' }, firm: { name: 'Sample Law Offices', addressLines: [], email: '' },
    }).map((p) => p.text).join('\n');
    expect(text).toContain('International Registration No.: 1234567');
    expect(text).toContain('Date of Designation: 1 September 2025');
  });

  it('says item C does not apply to a designation', () => {
    expect(extensionProblems(designation(), { purpose: 'fees', reasons: ['workload'], examiner: 'X' }, TODAY).join(' ')).toMatch(/paid to WIPO/);
  });

  it('owes no report on a national-only step, and a protection report once granted', () => {
    const events = reportableEvents(designation({ status: 'Registered', regDate: '2026-03-01', corReportedDate: '2026-03-05', publishedDate: '2026-01-10' }));
    expect(events).toEqual([{ event: 'published', date: '2026-01-10' }, { event: 'protection', date: '2026-03-05' }]);
  });
});

describe('madridFields', () => {
  it('maps a row read with MADRID_COLUMNS', () => {
    expect(madridFields({
      origin: 'madrid_in', ir_date: '2025-02-10', designation_date: null, dau_5_due_date: '2031-03-01',
      trademark_local_deadlines: [], international_registrations: [],
    })).toEqual({
      origin: 'madrid_in', irDate: '2025-02-10', designationDate: null,
      dau5DueDate: '2031-03-01', renewalDueDate: null, renewalDauDueDate: null, renewalDau5DueDate: null,
      irId: null, localAgent: null, refusalPeriodMonths: null, localDeadlines: [], internationalRegistrations: [],
    });
  });

  it('refuses a row read without them', () => {
    expect(() => madridFields({ id: 't' })).toThrow(/MADRID_COLUMNS/);
  });
});
