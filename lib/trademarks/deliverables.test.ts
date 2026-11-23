import { describe, it, expect } from 'vitest';
import type { Trademark, TrademarkOfficeAction } from '@/types/notion';
import type { MarkMatterLink } from './matter-links';
import { deliverableName, deliverableOptions, markDeliverableClassification, matterForStep, stepLabel } from './deliverables';

const TODAY = '2026-10-30';

function oa(id: string, mailingDate: string, p: Partial<TrademarkOfficeAction> = {}): TrademarkOfficeAction {
  return {
    id, trademarkId: 't', kind: 'office_action', title: null, mailingDate, receivedDate: null,
    respondBy: null, motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...p,
  };
}

function tm(p: Partial<Trademark>): Trademark {
  return {
    mark: 'ACME', status: 'Pending', origin: 'national',
    filingDate: '2026-01-15', noiDate: null, noiReceivedDate: null, noiPaymentDate: null, issuanceNoticeDate: null, issuanceNoticeReceivedDate: null, issuanceFeePaidDate: null,
    publishedDate: null, oppositionFiledDate: null, regDate: null, corReportedDate: null,
    officeActions: [], localDeadlines: [], internationalRegistrations: [],
    abandonmentMailingDate: null, abandonmentReceivedDate: null, revivalFiledDate: null,
    revivalDeclined: false, revivalCount: 0, statusBeforeAbandonment: null,
    dau3FilingDate: null, dau3Motex: false, dau3MotexDecision: null, dau3MotexDecidedOn: null, dau5FilingDate: null,
    renewalFilingDate: null, renewalDauFiledDate: null, renewalDau5FiledDate: null,
    ...p,
  } as unknown as Trademark;
}

const link = (scope: MarkMatterLink['scope'], matterId: string): MarkMatterLink => ({ scope, matterId, matterName: matterId, matterCode: null });

describe('deliverableOptions', () => {
  it('offers the application before filing', () => {
    const opts = deliverableOptions(tm({ status: 'For Filing', filingDate: null }), TODAY);
    expect(opts.map((o) => o.action)).toEqual(['mark_as_filed']);
  });

  it('offers a response and an extension for each open round, due on its bar date', () => {
    const t = tm({ status: 'Pending - OA', officeActions: [oa('a', '2026-09-01'), oa('b', '2026-10-01', { responseFiledDate: '2026-10-20' })] });
    const opts = deliverableOptions(t, TODAY).filter((o) => o.officeActionId);
    expect(opts).toEqual([
      { action: 'oa_response_filed', officeActionId: 'a', label: 'Response to Office Action 1', due: '2026-11-01' },
      { action: 'oa_response_motex', officeActionId: 'a', label: 'Request for extension — Office Action 1', due: '2026-11-01' },
    ]);
  });

  it('moves the response to the extended date once an extension is on record, and stops offering another', () => {
    const t = tm({ status: 'Pending - OA', officeActions: [oa('a', '2026-09-01', { motex: true })] });
    const opts = deliverableOptions(t, TODAY).filter((o) => o.officeActionId);
    expect(opts).toEqual([{ action: 'oa_response_filed', officeActionId: 'a', label: 'Response to Office Action', due: '2027-01-01' }]);
  });

  it('leaves out a step that already has open work', () => {
    const t = tm({ status: 'Pending - OA', officeActions: [oa('a', '2026-09-01')] });
    const opts = deliverableOptions(t, TODAY, [{ action: 'oa_response_filed', officeActionId: 'a' }]);
    expect(opts.some((o) => o.action === 'oa_response_filed')).toBe(false);
    expect(opts.some((o) => o.action === 'oa_response_motex')).toBe(true);
  });

  it('names a final rejection’s answer for what it is', () => {
    const t = tm({ status: 'Pending - OA', officeActions: [oa('f', '2026-09-01', { kind: 'final_rejection' })] });
    expect(stepLabel(t, 'oa_response_filed', 'f')).toBe('Appeal or compliance — Final rejection');
  });

  it('offers the 3rd-year DAU and its extension request, as the next step does', () => {
    const opts = deliverableOptions(tm({ status: 'Registered', filingDate: '2025-06-01', regDate: '2026-06-01' }), TODAY);
    expect(opts.map((o) => o.action)).toEqual(['dau_3_filed', 'dau_3_motex_filed']);
    expect(opts[1]).toMatchObject({ label: 'Request for extension — 3rd-year DAU', due: '2028-06-01' });
  });

  it('stops offering the extension once one is on record', () => {
    const opts = deliverableOptions(tm({ status: 'Registered', filingDate: '2025-06-01', regDate: '2026-06-01', dau3Motex: true, dau3MotexDecision: null, dau3MotexDecidedOn: null }), TODAY);
    expect(opts.map((o) => o.action)).toEqual(['dau_3_filed']);
  });
});

describe('a country designated abroad', () => {
  it('offers only the response to its refusal, with no IPOPHL extension or Philippine upkeep', () => {
    const t = tm({ origin: 'madrid_out', status: 'Pending - OA', filingDate: null, localDeadlines: [], internationalRegistrations: [],
      officeActions: [oa('a', '2026-09-01', { kind: 'provisional_refusal', respondBy: '2026-12-01' })] } as Partial<Trademark>);
    expect(deliverableOptions(t, TODAY)).toEqual([
      { action: 'oa_response_filed', officeActionId: 'a', label: 'Response to Provisional refusal', due: '2026-12-01' },
    ]);
    expect(markDeliverableClassification(t)).toEqual({ type: 'External', subtype: 'Other' });
    expect(markDeliverableClassification(tm({}))).toEqual({ type: 'External', subtype: 'Other' });
  });
});

describe('matterForStep', () => {
  const links = [link('retainer', 'r'), link('trademark', 'f'), link('trademark_maintenance', 'm')];
  it('puts a response under the filing matter and a DAU under maintenance', () => {
    expect(matterForStep('oa_response_filed', links)?.matterId).toBe('f');
    expect(matterForStep('dau_3_filed', links)?.matterId).toBe('m');
  });
  it('falls back to the retainer, and to nothing when no matter covers the mark', () => {
    expect(matterForStep('dau_5_filed', [link('retainer', 'r'), link('trademark', 'f')])?.matterId).toBe('r');
    expect(matterForStep('dau_5_filed', [])).toBeNull();
  });
});

it('names the deliverable for the mark and the work', () => {
  expect(deliverableName(tm({}), 'Response to Office Action 2')).toBe('ACME — Response to Office Action 2');
});
