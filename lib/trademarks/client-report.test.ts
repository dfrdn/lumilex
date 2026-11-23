import { describe, it, expect } from 'vitest';
import type { Trademark, TrademarkOfficeAction } from '@/types/notion';
import { annexDocumentFor, buildClientReport, owedReportEvents, reportEventForAction, reportableEvents } from './client-report';
import { annexCopies, annexSentence, reportEmailHtml } from '@/lib/client-reports/letter';

function tm(p: Partial<Trademark>): Trademark {
  return {
    id: 't', mark: 'TIFFIN TALE', type: 'Wordmark', classes: [21, 43], goodsServices: {},
    country: 'PH', owner: 'Tiffin Tale Foods Inc.', contactEmail: 'client@example.com', regIrNo: '4-2025-500123',
    clientId: 'c', clientName: 'Tiffin Tale Foods Inc.', clientCode: 900, clientIndex: 1,
    status: 'Pending', filingDate: '2025-02-13', noiDate: null, noiReceivedDate: null, noiPaymentDate: null, issuanceNoticeDate: null, issuanceNoticeReceivedDate: null, issuanceFeePaidDate: null,
    publishedDate: null, oppositionFiledDate: null, regDate: null, corReportedDate: null, localDeadlines: [], internationalRegistrations: [], officeActions: [],
    dau3FilingDate: null, dau3Motex: false, dau3MotexDecision: null, dau3MotexDecidedOn: null, dau5FilingDate: null,
    renewalFilingDate: null, renewalDauFiledDate: null, renewalDau5FiledDate: null,
    ...p,
  } as unknown as Trademark;
}

const OPTS = { today: '2026-10-19', signatory: { name: 'Juan Dela Cruz', position: 'Associate' }, annexes: ['the document'] };
const text = (r: ReturnType<typeof buildClientReport>) => r.paragraphs.map((p) => p.text).join('\n');

describe('reportEventForAction', () => {
  it('maps the recorded steps that have a report', () => {
    expect(reportEventForAction('mark_as_filed')).toBe('filing');
    expect(reportEventForAction('dau_3_filed')).toBe('dau_3');
    expect(reportEventForAction('dau_5_filed')).toBe('dau_5');
    expect(reportEventForAction('noi_paid')).toBe('noi_paid');
    expect(reportEventForAction('oa_response_motex')).toBe('oa_motex');
    expect(reportEventForAction('instructions_received')).toBeNull();
    expect(reportEventForAction('abandon')).toBeNull();
  });
});

describe('reportableEvents', () => {
  it('lists only the steps recorded on the mark', () => {
    expect(reportableEvents(tm({ dau3FilingDate: '2026-05-04' }))).toEqual([
      { event: 'filing', date: '2025-02-13' },
      { event: 'dau_3', date: '2026-05-04' },
    ]);
  });
});

describe('buildClientReport — filing', () => {
  const t = tm({ goodsServices: { 21: 'Food containers; food containers', 43: 'Restaurant services' } });
  const r = buildClientReport(t, 'filing', OPTS);

  it('counts the 3rd-year DAU from the filing date, with its extension', () => {
    expect(text(r)).toContain('on or before **13 February 2028**');
    expect(text(r)).toContain('by six (6) months to 13 August 2028');
    expect(r.caption.find((c) => c.label === 'Upcoming Deadline')?.value).toBe('Declaration of Actual Use (3rd Year) — 13 February 2028');
  });

  it('lists the goods or services class by class', () => {
    expect(text(r)).toContain('**Class 21** — Food containers; food containers');
    expect(text(r)).toContain('**Class 43** — Restaurant services');
    expect(r.problems).toEqual([]);
  });

  it('carries the Ref. No. and the event date', () => {
    expect(r.eventDate).toBe('2025-02-13');
    expect(r.subject).toBe('[900] TIFFIN TALE (Word mark) | Trademark Application Filing Report (4-2025-500123)');
    expect(text(r)).toContain('on 13 February 2025, we filed');
  });

  it('flags a class with no goods or services, and leaves a field for it', () => {
    const missing = buildClientReport(tm({ goodsServices: { 21: 'Food containers' } }), 'filing', OPTS);
    expect(missing.problems).toContain('No goods or services for Class 43.');
    expect(text(missing)).toContain('**Class 43** — [Goods or services in Class 43]');
  });

  it('trims a stray space off the mark', () => {
    const spaced = buildClientReport(tm({ mark: 'TIFFIN TALE ' }), 'filing', OPTS);
    expect(spaced.subject.startsWith('[900] TIFFIN TALE (Word mark) | ')).toBe(true);
    expect(text(spaced)).toContain('“TIFFIN TALE”');
  });

  it('flags a mark with no client until the letter is addressed', () => {
    const noClient = tm({ clientName: '' });
    expect(buildClientReport(noClient, 'filing', OPTS).problems)
      .toContain('No client on the mark — fill in who the letter is addressed to.');
    expect(buildClientReport(noClient, 'filing', { ...OPTS, letter: { addressee: 'Rosa Mercado' } }).problems)
      .not.toContain('No client on the mark — fill in who the letter is addressed to.');
  });

  it('only mentions Annex "A" when there is one', () => {
    const none = buildClientReport(t, 'filing', { ...OPTS, annexes: [] });
    expect(text(r)).toContain('Annex “A”');
    expect(text(none)).not.toContain('Annex');
    expect(none.message).not.toContain('copy of the document');
  });

  it('letters each annex in order, in the letter and the email', () => {
    const r = buildClientReport(t, 'filing', { ...OPTS, annexes: ['the application as filed', 'the specimen of use'] });
    expect(text(r)).toContain('A copy of the application as filed is attached as Annex “A”, and a copy of the specimen of use as Annex “B”.');
    expect(r.message).toContain('and copies of the application as filed and the specimen of use,');
  });
});

describe('annex wording', () => {
  it('names one, two or several papers', () => {
    expect(annexSentence([])).toBe('');
    expect(annexSentence(['the notice'])).toBe('A copy of the notice is attached as Annex “A”.');
    expect(annexSentence(['the notice', 'the receipt', 'the *label*'])).toBe(
      'A copy of the notice is attached as Annex “A”, a copy of the receipt as Annex “B”, and a copy of the label as Annex “C”.',
    );
    expect(annexCopies(['the notice'])).toBe('a copy of the notice');
    expect(annexCopies(['the notice', 'the receipt', 'the label'])).toBe('copies of the notice, the receipt, and the label');
  });

  it('first calls a picked paper by its step, else by its file name', () => {
    expect(annexDocumentFor({ name: 'oa.pdf', step: 'office_action' })).toBe('the Office Action');
    expect(annexDocumentFor({ name: 'specimen_photos.pdf', step: null })).toBe('specimen photos');
  });
});

describe('buildClientReport — reference table', () => {
  it('sets Attention, the caption and the Ref. No. in the ruled field table, the deadline date under its name', () => {
    const r = buildClientReport(tm({}), 'filing', { ...OPTS, letter: { attention: 'Ms. Jane Reyes' } });
    const table = r.paragraphs.find((p) => p.type === 'fields');
    expect(table?.ruleBelow).toBe(true);
    expect(table?.fields?.[0]).toEqual({ label: 'Attention', lines: ['**Ms. Jane Reyes**'] });
    expect(table?.fields?.find((f) => f.label === 'Upcoming Deadline')?.lines)
      .toEqual(['**Declaration of Actual Use (3rd Year)**', '**13 February 2028**']);
    expect(table?.fields?.at(-1)).toEqual({ label: 'Ref. No.', lines: ['900-01-PH-4-2025-500123'] });
  });

  it('leaves Attention out when none is given', () => {
    const table = buildClientReport(tm({}), 'filing', OPTS).paragraphs.find((p) => p.type === 'fields');
    expect(table?.fields?.[0].label).toBe('Applicant');
  });
});

describe('buildClientReport — DAUs', () => {
  it('a 3rd-year DAU on a pending mark says the 5th-year DAU waits for registration', () => {
    const r = buildClientReport(tm({ dau3FilingDate: '2026-05-04' }), 'dau_3', OPTS);
    expect(text(r)).toContain('on 4 May 2026, we filed');
    expect(text(r)).toContain('when IPOPHL issues the Certificate of Registration');
  });

  it('a 3rd-year DAU on a registered mark gives the 5th-year window from registration', () => {
    const r = buildClientReport(tm({ status: 'Registered', regDate: '2025-09-01', dau3FilingDate: '2026-05-04' }), 'dau_3', OPTS);
    expect(text(r)).toContain('between **1 September 2030** and **1 September 2031**');
    expect(r.caption.find((c) => c.label === 'Registration No.')).toBeTruthy();
  });

  it('a 5th-year DAU gives the expiry and the renewal window', () => {
    const r = buildClientReport(tm({ status: 'Registered', regDate: '2020-04-23', dau5FilingDate: '2026-03-01' }), 'dau_5', OPTS);
    expect(text(r)).toContain('in force until **23 April 2030**');
    expect(text(r)).toContain('between **23 October 2029** and **23 April 2030**');
    expect(text(r)).toContain('until 23 October 2030, on payment of a surcharge');
  });

  it('refuses a report for a step not recorded', () => {
    expect(() => buildClientReport(tm({}), 'dau_5', OPTS)).toThrow();
  });
});

describe('buildClientReport — prosecution', () => {
  const oa = (p: Partial<TrademarkOfficeAction>): TrademarkOfficeAction => ({
    id: 'oa1', trademarkId: 't', kind: 'office_action', title: 'Registrability Report', mailingDate: '2025-06-02',
    receivedDate: '2025-06-05', respondBy: null, motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...p,
  });

  it('an Office Action gives the response deadline from the mailing date and its extension', () => {
    const r = buildClientReport(tm({ status: 'Pending - OA', officeActions: [oa({})] }), 'oa_received', OPTS);
    expect(r.eventDate).toBe('2025-06-05');
    expect(text(r)).toContain('has issued the Office Action (Registrability Report) dated 2 June 2025');
    expect(text(r)).toContain('on or before **2 August 2025**');
    expect(text(r)).toContain('to 2 October 2025');
    expect(text(r)).toContain('Annex “A”');
    expect(r.caption.find((c) => c.label === 'Upcoming Deadline')?.value).toBe('Response to Office Action — 2 August 2025');
  });

  it('a final rejection speaks of an appeal, and an examiner’s own period of good cause only', () => {
    const final = buildClientReport(tm({ officeActions: [oa({ kind: 'final_rejection' })] }), 'oa_received', OPTS);
    expect(text(final)).toContain('has issued a final rejection dated');
    expect(text(final)).toContain('appealed to the Director of the Bureau of Trademarks');
    const set = buildClientReport(tm({ officeActions: [oa({ respondBy: '2025-07-02' })] }), 'oa_received', OPTS);
    expect(text(set)).toContain('a period the examiner set');
  });

  it('a response report names the round it answered and the next deadline owed', () => {
    const r = buildClientReport(tm({ officeActions: [oa({ responseFiledDate: '2025-07-20' })] }), 'oa_response', OPTS);
    expect(r.eventDate).toBe('2025-07-20');
    expect(text(r)).toContain('our response to the Office Action (Registrability Report) dated 2 June 2025');
    expect(r.caption.find((c) => c.label === 'Upcoming Deadline')?.value).toBe('Declaration of Actual Use (3rd Year) — 13 February 2028');
  });

  it('an extension report gives the extended response date', () => {
    const r = buildClientReport(tm({ officeActions: [oa({ motex: true })] }), 'oa_motex', OPTS);
    expect(text(r)).toContain('now due on or before **2 October 2025**');
  });

  it('a Notice of Allowance says nothing is due on a filing from Feb 14, 2023', () => {
    const r = buildClientReport(tm({ noiDate: '2025-09-10', noiReceivedDate: '2025-09-12' }), 'noi_received', OPTS);
    expect(text(r)).toContain('Notice of Allowance dated 10 September 2025, which we received on 12 September 2025');
    expect(text(r)).toContain('No fee is due on the notice');
    expect(text(r)).not.toContain('and Issuance');
    expect(r.message).not.toContain('must be paid');
  });

  it('a Notice of Allowance on an earlier filing gives the 1st publication fee deadline', () => {
    const r = buildClientReport(tm({ filingDate: '2023-01-10', noiDate: '2025-09-10' }), 'noi_received', OPTS);
    expect(text(r)).toContain('1st publication fee must be paid');
    expect(text(r)).toContain('on or before **10 November 2025**');
    expect(r.message).toContain('The 1st publication fee must be paid on or before 10 November 2025.');
  });

  it('a publication report gives the end of the opposition period and what follows', () => {
    const r = buildClientReport(tm({ publishedDate: '2025-11-03' }), 'published', OPTS);
    expect(text(r)).toContain('until **3 December 2025**');
    expect(text(r)).toContain('Notice of Issuance for the issuance and 2nd publication fees, and then the Certificate of Registration');
  });

  it('a Notice of Issuance report gives the two-month fee deadline', () => {
    const r = buildClientReport(
      tm({ publishedDate: '2025-11-03', issuanceNoticeDate: '2025-12-10', issuanceNoticeReceivedDate: '2025-12-11' }), 'issuance_received', OPTS,
    );
    expect(text(r)).toContain('Notice of Issuance dated 10 December 2025, which we received on 11 December 2025');
    expect(text(r)).toContain('on or before **10 February 2026**');
  });

  it('a registration report gives the expiry and the DAUs still owed', () => {
    const r = buildClientReport(
      tm({ status: 'Registered', regDate: '2025-12-04', corReportedDate: '2026-01-15' }), 'cor', OPTS,
    );
    expect(r.eventDate).toBe('2026-01-15');
    expect(text(r)).toContain('effective 4 December 2025');
    expect(text(r)).toContain('until **4 December 2035**');
    expect(text(r)).toContain('on or before **13 February 2028**');
    expect(text(r)).toContain('between **4 December 2030** and **4 December 2031**');
  });

  it('a 3rd-year DAU extension gives the extended date', () => {
    const r = buildClientReport(tm({ dau3Motex: true, dau3MotexDecision: null, dau3MotexDecidedOn: null }), 'dau_3_motex', OPTS);
    expect(text(r)).toContain('which was due on 13 February 2028');
    expect(text(r)).toContain('now due on or before **13 August 2028**');
  });
});

describe('buildClientReport — renewal', () => {
  const reg = { status: 'Registered' as const, regDate: '2016-04-23' };

  it('a renewal report gives the new term and the DAU after renewal', () => {
    const r = buildClientReport(tm({ ...reg, renewalFilingDate: '2026-03-01' }), 'renewal', OPTS);
    expect(text(r)).toContain('until **23 April 2036**');
    expect(text(r)).toContain('between **23 October 2025** and **23 April 2027**');
  });

  it('the DAUs after renewal point to the next one, then to the renewed term’s end', () => {
    const one = buildClientReport(tm({ ...reg, renewalFilingDate: '2026-03-01', renewalDauFiledDate: '2026-06-01' }), 'renewal_dau', OPTS);
    expect(text(one)).toContain('between **23 April 2031** and **23 April 2032**');
    const two = buildClientReport(tm({ ...reg, renewalDau5FiledDate: '2031-06-01' }), 'renewal_dau_5', OPTS);
    expect(text(two)).toContain('in force until **23 April 2036**');
  });
});

describe('email caption', () => {
  it('names the next deadline in brackets, with its date in bold, as the firm’s emails do', () => {
    const r = buildClientReport(tm({}), 'filing', OPTS);
    expect(r.emailCaption.map((c) => c.label)).toEqual(['Applicant', 'Mark', 'Application No.', 'Date Filed', 'Classes', 'Upcoming Deadline (3rd Year DAU)']);
    expect(r.emailCaption.at(-1)).toEqual({ label: 'Upcoming Deadline (3rd Year DAU)', value: '13 February 2028', bold: true });
    expect(r.emailCaption[1]).toEqual({ label: 'Mark', value: 'TIFFIN TALE', bold: true });
  });

  it('opens the filing email with what was filed and asks for confirmation of receipt', () => {
    const r = buildClientReport(tm({}), 'filing', OPTS);
    expect(r.message).toContain('was filed with the Intellectual Property Office of the Philippines (IPOPHL) on 13 February 2025.');
    expect(r.message).toContain('Please find attached our Filing Report and a copy of');
    expect(r.message).toContain('Kindly confirm receipt');
  });
});

describe('reportEmailHtml', () => {
  const html = reportEmailHtml({
    message: 'Hi <there>\n\nSecond',
    caption: [{ label: 'Mark', value: 'A&B', bold: true }, { label: 'Upcoming Deadline (3rd Year DAU)', value: '13 February 2028', bold: true }],
    refNo: '1-01-PH-x', senderName: 'Ana Reyes', senderPosition: 'Senior Associate',
    firm: { name: 'Sample Law Offices', addressLines: ['1 Sample Street', 'Makati City'] },
  });

  it('escapes what it is given and sets the Ref. No. above the caption', () => {
    expect(html).toContain('Hi &lt;there&gt;</p>');
    expect(html).toContain('<b>A&amp;B</b>');
    expect(html.indexOf('Ref. No.: 1-01-PH-x')).toBeLessThan(html.indexOf('A&amp;B'));
  });

  it('signs off with the sender’s name in capitals, their position, and the firm', () => {
    expect(html).toContain('Warm regards,');
    expect(html).toContain('<b>ANA REYES</b>');
    expect(html).toContain('<i>Senior Associate</i>');
    expect(html).toContain('Sample Law Offices');
    expect(html).toContain('1 Sample Street');
  });
});

describe('reports on an extension decision', () => {
  const r = (p: Partial<TrademarkOfficeAction>): TrademarkOfficeAction => ({
    id: 'oa1', trademarkId: 't', kind: 'office_action', title: null, mailingDate: '2026-06-01', receivedDate: null,
    respondBy: null, motex: true, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...p,
  });

  it('offers the grant or the denial once IPOPHL decides, dated by its order', () => {
    expect(reportEventForAction('oa_motex_granted')).toBe('oa_motex_granted');
    expect(reportEventForAction('dau_3_motex_denied')).toBe('dau_3_motex_denied');
    const pending = tm({ status: 'Pending - OA', officeActions: [r({})] });
    expect(reportableEvents(pending).some((e) => e.event.startsWith('oa_motex_'))).toBe(false);
    const denied = tm({ status: 'Pending - OA', officeActions: [r({ motexDecision: 'denied', motexDecidedOn: '2026-07-20' })] });
    expect(reportableEvents(denied)).toContainEqual({ event: 'oa_motex_denied', date: '2026-07-20' });
  });

  it('names the original deadline on a denial', () => {
    const denied = tm({ status: 'Pending - OA', officeActions: [r({ motexDecision: 'denied', motexDecidedOn: '2026-07-20' })] });
    const report = buildClientReport(denied, 'oa_motex_denied', OPTS);
    expect(text(report)).toContain('ending on **1 August 2026**');
  });
});

describe('owedReportEvents', () => {
  const round = (p: Partial<TrademarkOfficeAction>): TrademarkOfficeAction => ({
    id: 'oa1', trademarkId: 't', kind: 'office_action', title: null, mailingDate: '2026-10-20', receivedDate: null,
    respondBy: null, motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...p,
  });
  const oaOwed = (t: Trademark, sent: { event: string; eventDate: string }[], today: string) =>
    owedReportEvents(t, sent, today).filter((s) => s.event === 'oa_received');

  it('keeps a report sent while the receipt was unconfirmed once the day is filled in', () => {
    const sent = [{ event: 'oa_received', eventDate: '2026-10-20' }];
    const filled = tm({ status: 'Pending - OA', officeActions: [round({ receivedDate: '2026-10-24' })] });
    expect(oaOwed(filled, sent, '2026-11-04')).toEqual([]);
  });

  it('offers an unconfirmed Office Action dated long ago while it can still be answered', () => {
    const t = tm({ status: 'Pending - OA', officeActions: [round({ mailingDate: '2026-08-20' })] });
    expect(oaOwed(t, [], '2026-11-04')).toEqual([{ event: 'oa_received', date: '2026-08-20' }]);
  });

  it('stops offering it once the response window has closed or it was answered', () => {
    const closed = tm({ status: 'Pending - OA', officeActions: [round({ mailingDate: '2026-01-10' })] });
    expect(oaOwed(closed, [], '2026-11-04')).toEqual([]);
    const answered = tm({ officeActions: [round({ mailingDate: '2026-08-20', responseFiledDate: '2026-10-01' })] });
    expect(oaOwed(answered, [], '2026-11-04')).toEqual([]);
  });

  it('dates a confirmed Office Action by its receipt for recency', () => {
    const t = tm({ status: 'Pending - OA', officeActions: [round({ mailingDate: '2026-08-20', receivedDate: '2026-08-25' })] });
    expect(oaOwed(t, [], '2026-11-04')).toEqual([]);
  });
});
