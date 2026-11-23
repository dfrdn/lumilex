import type { Trademark, TrademarkOfficeAction } from '@/types/notion';
import type { ReportEvent } from './client-report';

/**
 * A made-up mark taken through its life up to a given report's step, so the
 * Report wording page can preview any report with every field filled. No
 * client's data: the names and numbers here are invented.
 */

const OA: TrademarkOfficeAction = {
  id: 'sample-oa', trademarkId: 'sample', kind: 'office_action', title: 'Registrability Report', mailingDate: '2025-06-02',
  receivedDate: '2025-06-05', respondBy: null, motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null,
};

const BASE = {
  id: 'sample', mark: 'SAMPLE MARK', type: 'Wordmark', classes: [21, 43],
  goodsServices: { 21: 'Lunch boxes; food containers; insulated bags for food', 43: 'Restaurant and catering services' },
  country: 'PH', owner: 'Sample Food Corporation', contactEmail: null, regIrNo: '4-2025-500001', origin: 'national',
  clientId: null, clientName: 'Sample Food Corporation', clientCode: 100, clientIndex: 1, matterId: null, matterName: '',
  status: 'Pending', filingDate: '2025-02-13', noiDate: null, noiReceivedDate: null, noiPaymentDate: null, issuanceNoticeDate: null, issuanceNoticeReceivedDate: null, issuanceFeePaidDate: null, publishedDate: null,
  oppositionFiledDate: null, regDate: null, corReportedDate: null, localDeadlines: [], internationalRegistrations: [], officeActions: [] as TrademarkOfficeAction[],
  dau3FilingDate: null, dau3Motex: false, dau3MotexDecision: null, dau3MotexDecidedOn: null, dau5FilingDate: null, renewalFilingDate: null, renewalDauFiledDate: null, renewalDau5FiledDate: null,
} as unknown as Trademark;

type Sample = Trademark;

/** Each step in the order a mark lives through them, and what it records. */
const STEPS: [ReportEvent, (t: Sample) => void][] = [
  ['filing', () => {}],
  ['oa_received', (t) => { t.status = 'Pending - OA'; t.officeActions = [{ ...OA }]; }],
  ['oa_motex', (t) => { t.officeActions = [{ ...t.officeActions[0], motex: true }]; }],
  // A denial is previewed on its own; the mark lives on with the grant.
  ['oa_motex_denied', (t) => { t.officeActions = [{ ...t.officeActions[0], motexDecision: 'denied', motexDecidedOn: '2025-08-01' }]; }],
  ['oa_motex_granted', (t) => { t.officeActions = [{ ...t.officeActions[0], motexDecision: 'granted', motexDecidedOn: '2025-08-01' }]; }],
  ['oa_response', (t) => { t.status = 'Pending'; t.officeActions = [{ ...t.officeActions[0], responseFiledDate: '2025-09-25' }]; }],
  ['noi_received', (t) => { t.noiDate = '2025-11-10'; t.noiReceivedDate = '2025-11-12'; }],
  ['noi_paid', (t) => { t.noiPaymentDate = '2025-11-20'; }],
  ['published', (t) => { t.publishedDate = '2025-12-01'; }],
  ['issuance_received', (t) => { t.issuanceNoticeDate = '2026-01-05'; t.issuanceNoticeReceivedDate = '2026-01-06'; }],
  ['issuance_paid', (t) => { t.issuanceFeePaidDate = '2026-01-12'; }],
  ['cor', (t) => { t.status = 'Registered'; t.regDate = '2026-01-02'; t.corReportedDate = '2026-01-15'; t.regIrNo = '4-2025-500001'; }],
  ['dau_3_motex', (t) => { t.dau3Motex = true; }],
  ['dau_3_motex_denied', (t) => { t.dau3MotexDecision = 'denied'; t.dau3MotexDecidedOn = '2028-03-01'; }],
  ['dau_3_motex_granted', (t) => { t.dau3MotexDecision = 'granted'; t.dau3MotexDecidedOn = '2028-03-01'; }],
  ['dau_3', (t) => { t.dau3FilingDate = '2028-07-01'; }],
  ['dau_5', (t) => { t.dau5FilingDate = '2031-03-01'; }],
  ['renewal', (t) => { t.renewalFilingDate = '2035-09-01'; }],
  ['renewal_dau', (t) => { t.renewalDauFiledDate = '2036-03-01'; }],
  ['renewal_dau_5', (t) => { t.renewalDau5FiledDate = '2041-03-01'; }],
];

/**
 * The same mark designated in the United States under an international
 * registration resting on it, for the reports a Madrid designation has its
 * own wording for.
 */
function sampleDesignation(event: ReportEvent): Trademark {
  const refusal: TrademarkOfficeAction = {
    ...OA, id: 'sample-refusal', kind: 'provisional_refusal', title: null, mailingDate: '2026-02-02', receivedDate: '2026-02-09', respondBy: '2026-05-04',
  };
  const t: Sample = {
    ...BASE, origin: 'madrid_out', country: 'US', regIrNo: '1700001', irDate: '2025-09-01', filingDate: null, refusalPeriodMonths: 18,
    status: 'Pending - OA', officeActions: [refusal],
  };
  if (event === 'oa_response' || event === 'protection') {
    t.status = 'Pending';
    t.officeActions = [{ ...refusal, responseFiledDate: '2026-04-20' }];
  }
  if (event === 'protection') {
    t.status = 'Registered';
    t.regDate = '2026-08-03';
    t.corReportedDate = '2026-08-10';
  }
  return t;
}

export function sampleMarkFor(event: ReportEvent, opts: { finalRejection?: boolean; designation?: boolean } = {}): Trademark {
  if (opts.designation || event === 'protection') return sampleDesignation(event);
  const t: Sample = { ...BASE, officeActions: [] };
  for (const [step, apply] of STEPS) {
    apply(t);
    if (step === event) break;
  }
  if (opts.finalRejection && t.officeActions[0]) t.officeActions = [{ ...t.officeActions[0], kind: 'final_rejection' }];
  return t;
}
