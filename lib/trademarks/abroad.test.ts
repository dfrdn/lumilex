import { describe, it, expect } from 'vitest';
import type { InternationalRegistration, Trademark, TrademarkOfficeAction } from '@/types/notion';
import { dependencyEnds, irRenewalPeriod, pendingDeadlines, refusalPeriodEnds, transformationDeadline } from '@/lib/trademark-deadlines';
import { trademarkNextStep, trademarkSteps, trademarkTracks } from './journey';
import { buildTrademarkStatus } from './status';
import { countryName, parseCountries } from './countries';
import { basicMarkProblem, designationCountries } from './international';
import { markDeadlineCopy, markStatusCopy } from '@/lib/portal/company-wording';
import { REPORT_EVENTS, buildClientReport, reportableEvents } from './client-report';

const TODAY = '2026-10-30';

const IR: InternationalRegistration = {
  id: 'ir1', irNo: '1700001', irDate: '2026-03-02', applicationFiledDate: '2026-02-20', renewalFilingDate: null, ceasedDate: null, notes: null,
};

function refusal(id: string, mailingDate: string, p: Partial<TrademarkOfficeAction> = {}): TrademarkOfficeAction {
  return {
    id, trademarkId: 't', kind: 'provisional_refusal', title: null, mailingDate, receivedDate: null,
    respondBy: '2027-01-15', motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...p,
  };
}

function mark(p: Partial<Trademark> = {}): Trademark {
  return {
    id: 't', mark: 'SAMPLE', origin: 'national', country: 'PH', regIrNo: '4-2025-500001', irId: null, irDate: null, designationDate: null,
    localAgent: null, refusalPeriodMonths: null, status: 'Registered', filingDate: '2025-02-01', regDate: '2025-12-01',
    noiDate: null, noiPaymentDate: null, issuanceNoticeDate: null, issuanceFeePaidDate: null, publishedDate: null, oppositionFiledDate: null,
    corReportedDate: null, abandonmentMailingDate: null, revivalFiledDate: null, revivalDeclined: false, revivalCount: 0,
    dau3FilingDate: '2026-01-15', dau3Motex: false, dau3MotexDecision: null, dau3MotexDecidedOn: null, dau5FilingDate: null, renewalFilingDate: null, renewalDauFiledDate: null, renewalDau5FiledDate: null,
    dau5DueDate: null, renewalDueDate: null, renewalDauDueDate: null, renewalDau5DueDate: null,
    localDeadlines: [], internationalRegistrations: [], parentRegistration: null, officeActions: [],
    ...p,
  } as unknown as Trademark;
}

/** The United States, designated in IR 1700001. */
const abroad = (p: Partial<Trademark> = {}) => mark({
  origin: 'madrid_out', country: 'US', irId: 'ir1', regIrNo: '1700001', irDate: '2026-03-02', refusalPeriodMonths: 18,
  status: 'Pending', filingDate: null, regDate: null, dau3FilingDate: null, ...p,
});

describe('a country designated abroad', () => {
  it('owes no Philippine declarations or renewal', () => {
    expect(pendingDeadlines(abroad({ status: 'Registered', regDate: '2027-01-10' }))).toEqual([]);
  });

  it('answers a refusal by the date on its notice, and owes its local filings', () => {
    const owed = pendingDeadlines(abroad({
      status: 'Pending - OA',
      officeActions: [refusal('r', '2026-11-01')],
      localDeadlines: [
        { id: 'l1', label: 'Declaration of use (6th year)', dueDate: '2032-03-02', filedDate: null },
        { id: 'l2', label: 'Translation', dueDate: '2026-12-01', filedDate: '2026-11-20' },
      ],
    }));
    expect(owed.map((d) => [d.kind, d.due, d.title ?? null])).toEqual([
      ['OA Response', '2027-01-15', null],
      ['Local Filing', '2032-03-02', 'Declaration of use (6th year)'],
    ]);
  });

  it('counts about when its office runs out of time to refuse', () => {
    expect(refusalPeriodEnds(abroad())).toBe('2027-09-02');
    expect(refusalPeriodEnds(abroad({ refusalPeriodMonths: 12, designationDate: '2026-06-01' }))).toBe('2027-06-01');
  });

  it('waits on the office, then asks for the protection once its time has run', () => {
    const waiting = trademarkNextStep(abroad(), TODAY);
    expect(waiting.title).toBe('Under examination in United States');
    expect(waiting.body).toMatch(/until about Sep 2, 2027 \(18 months\)/);
    expect(waiting.actions.map((a) => [a.action, !!a.primary])).toEqual([['oa_received', true], ['protection_granted', false]]);

    const lapsed = trademarkNextStep(abroad(), '2027-09-03');
    expect(lapsed.title).toBe('No refusal recorded from United States');
    expect(lapsed.actions.find((a) => a.action === 'protection_granted')?.primary).toBe(true);
  });

  it('waits on the office after an answered refusal, even once its time to refuse has run', () => {
    const answered = abroad({ officeActions: [refusal('r', '2027-08-01', { responseFiledDate: '2027-10-01' })] });
    const step = trademarkNextStep(answered, '2027-11-01');
    expect(step.title).toBe('Waiting on the office in United States after the response');
    expect(step.body).toBe('Response filed Oct 1, 2027.');
  });

  it('asks for the response to a refusal, naming the local agent', () => {
    const step = trademarkNextStep(abroad({ status: 'Pending - OA', officeActions: [refusal('r', '2026-11-01')], localAgent: 'Smith & Co.' }), '2026-11-10');
    expect(step.title).toBe('Respond to the provisional refusal in United States');
    expect(step.body).toMatch(/Local agent: Smith & Co\./);
    expect(step.due?.due).toBe('2027-01-15');
  });

  it('names its steps for the country', () => {
    expect(trademarkSteps(abroad(), TODAY)!.map((s) => s.sub)).toEqual([
      'Designated Mar 2, 2026', 'Under examination', 'Refusal period ends about Sep 2, 2027', 'Local filings',
    ]);
  });

  it('tracks its local filings as its upkeep once protected', () => {
    const t = abroad({ status: 'Registered', regDate: '2027-01-10', localDeadlines: [{ id: 'l1', label: 'Declaration of use', dueDate: '2032-03-02', filedDate: null }] });
    const upkeep = trademarkTracks(t, TODAY).find((k) => k.key === 'upkeep')!;
    expect(upkeep).toMatchObject({ done: 0, total: 1, summary: 'Declaration of use due Mar 2, 2032' });
  });

  it('keys two local filings due the same day apart in the stored status', () => {
    const t = abroad({ localDeadlines: [
      { id: 'a', label: 'One', dueDate: '2027-02-01', filedDate: null },
      { id: 'b', label: 'Two', dueDate: '2027-02-01', filedDate: null },
    ] });
    const items = buildTrademarkStatus(t, { today: TODAY }).items;
    expect(items.map((i) => [i.key, i.label])).toEqual([['local-filing:a', 'One'], ['local-filing:b', 'Two']]);
  });

  it('owes no report on a Philippine step, and a protection report once granted', () => {
    expect(reportableEvents(abroad({ status: 'Registered', regDate: '2027-01-10', dau3FilingDate: '2027-02-01' })))
      .toEqual([{ event: 'protection', date: '2027-01-10' }]);
  });
});

describe('the basic mark', () => {
  it('owes the renewal of its international registration with WIPO', () => {
    const owed = pendingDeadlines(mark({ internationalRegistrations: [IR] })).filter((d) => d.kind === 'IR Renewal');
    expect(owed).toMatchObject([{ due: '2036-03-02', extendedDue: '2036-09-02', extensionBasis: 'surcharge', irId: 'ir1' }]);
    expect(irRenewalPeriod({ irDate: null })).toBeNull();
  });

  it('owes no renewal when the mark fell within the five years, since the IR fell with it', () => {
    expect(pendingDeadlines(mark({ status: 'Abandoned', abandonmentMailingDate: '2028-01-10', internationalRegistrations: [IR] }))).toEqual([
      expect.objectContaining({ kind: 'Revival' }),
    ]);
  });

  it('keeps owing it when the mark is abandoned after five years, and stops once the IR is renewed or has ceased', () => {
    expect(pendingDeadlines(mark({ status: 'Abandoned', abandonmentMailingDate: '2031-06-01', revivalDeclined: true, internationalRegistrations: [IR] })).map((d) => d.kind)).toEqual(['IR Renewal']);
    expect(pendingDeadlines(mark({ internationalRegistrations: [{ ...IR, renewalFilingDate: '2036-01-10' }] })).some((d) => d.kind === 'IR Renewal')).toBe(false);
    expect(pendingDeadlines(mark({ internationalRegistrations: [{ ...IR, ceasedDate: '2027-05-01' }] })).some((d) => d.kind === 'IR Renewal')).toBe(false);
  });

  it('carries the registration for five years, and gives three months to transform once it ceases', () => {
    expect(dependencyEnds(IR)).toBe('2031-03-02');
    expect(transformationDeadline({ ceasedDate: '2027-05-01' })).toBe('2027-08-01');
    expect(transformationDeadline(IR)).toBeNull();
  });

  it('must be a Philippine application already filed', () => {
    expect(basicMarkProblem(mark())).toBeNull();
    expect(basicMarkProblem(mark({ status: 'For Filing', filingDate: null }))).toMatch(/File the Philippine application first/);
    expect(basicMarkProblem(mark({ origin: 'madrid_in' }))).toMatch(/Only a Philippine application/);
    expect(basicMarkProblem(mark({ status: 'Abandoned' }))).toMatch(/abandoned/);
  });
});

describe('countries', () => {
  it('names countries and regional offices', () => {
    expect(['US', 'JP', 'EM', 'BX', 'OA'].map(countryName)).toEqual(['United States', 'Japan', 'European Union', 'Benelux', 'OAPI']);
  });

  it('reads a typed list, setting apart what it can’t use', () => {
    expect(parseCountries('us, jp; EU ph zz, US')).toEqual({ codes: ['US', 'JP', 'EM'], unknown: ['PH', 'ZZ'] });
  });

  it('refuses a country already designated', () => {
    expect(designationCountries(['US', 'SG'], ['US'])).toEqual({ error: 'Already designated: US' });
    expect(designationCountries(['XX'])).toEqual({ error: 'Not a country or regional office: XX' });
    expect(designationCountries(['sg', 'kr'])).toEqual({ codes: ['SG', 'KR'] });
  });
});

describe('reports on a designation', () => {
  const at = (p: Partial<Trademark> = {}) => abroad({ owner: 'Sample Corp', clientName: 'Sample Corp', classes: [9], ...p });
  const build = (t: Trademark, event: Parameters<typeof buildClientReport>[1]) =>
    buildClientReport(t, event, { today: TODAY, signatory: { name: 'Juan dela Cruz' }, annexes: [] });

  it('captions the IR, its date and the country, and names the refusal', () => {
    const r = build(at({ status: 'Pending - OA', officeActions: [refusal('r', '2026-11-01', { receivedDate: '2026-11-03' })] }), 'oa_received');
    const rows = Object.fromEntries(r.caption.map((c) => [c.label, c.value]));
    expect(rows).toMatchObject({
      'International Registration No.': '1700001',
      'Date of International Registration': '2 March 2026',
      'Designated Country': 'United States',
      Re: 'Provisional Refusal Received',
      'Upcoming Deadline': 'Response to the Refusal — 15 January 2027',
    });
    expect(r.subject).toBe('SAMPLE | Provisional Refusal Report — United States (1700001)');
    const body = r.paragraphs.map((p) => p.text).join('\n');
    expect(body).toContain('the trademark office of the United States has issued a provisional refusal dated 1 November 2026 on International Registration No. 1700001');
    expect(body).toContain('will not be protected in the United States');
    expect(r.message).toMatch(/as it designates the United States/);
  });

  it('reports the grant of protection', () => {
    const r = build(at({ status: 'Registered', regDate: '2027-01-10', corReportedDate: '2027-01-12' }), 'protection');
    expect(r.caption.find((c) => c.label === 'Date Protection Granted')?.value).toBe('10 January 2027');
    expect(r.paragraphs.map((p) => p.text).join('\n')).toContain('has granted protection to the mark **“SAMPLE”** in the United States under International Registration No. 1700001, by a statement of grant of protection dated 10 January 2027');
  });

  it('keeps the national wording for a national mark', () => {
    expect(REPORT_EVENTS.protection.date(mark())).toBeNull();
    const r = build(mark({ owner: 'Sample Corp', clientName: 'Sample Corp', classes: [9], goodsServices: {}, status: 'Pending - OA', regDate: null, officeActions: [{ ...refusal('o', '2026-11-01'), kind: 'office_action', respondBy: null }] }), 'oa_received');
    expect(r.caption.find((c) => c.label === 'Re')?.value).toBe('Office Action Received');
  });
});

describe('portal words for a designation', () => {
  it('says protected, and calls the round a refusal', () => {
    expect(markStatusCopy('Registered', true)).toEqual({ label: 'Protected', tone: 'green' });
    expect(markStatusCopy('Registered', false).label).toBe('Registered');
    expect(markStatusCopy('Pending - OA', true).label).toBe('Responding to the refusal');
    expect(markDeadlineCopy('OA Response', true)).toBe('Response to the refusal');
    expect(markDeadlineCopy('OA Response', false)).toBe('Response to the examiner (Office Action)');
    expect(markDeadlineCopy('Local Filing', true)).toBe('A filing the designated country requires');
  });
});
