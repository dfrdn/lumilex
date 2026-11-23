import { describe, expect, it } from 'vitest';
import type { Trademark, TrademarkOfficeAction } from '@/types/notion';
import { buildExtensionRequest, extensionProblems, suggestedExtension } from './extension-request';

const OA: TrademarkOfficeAction = {
  id: 'oa1', trademarkId: 't', kind: 'office_action', title: null, mailingDate: '2026-09-01',
  receivedDate: '2026-09-03', respondBy: null, motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null,
};

const mark = (over: Partial<Trademark> = {}): Trademark => ({
  id: 't', mark: 'SAMPLE', regIrNo: '4-2026-500001', filingDate: '2026-02-01', status: 'Pending - OA',
  localDeadlines: [], internationalRegistrations: [], officeActions: [OA], dau3FilingDate: null, dau3Motex: false, dau3MotexDecision: null, dau3MotexDecidedOn: null, regDate: null, classes: [21],
  owner: 'Sample Corp', clientName: 'Sample Corp',
  ...over,
} as unknown as Trademark);

const text = (ps: { text: string }[]) => ps.map((p) => p.text).join('\n');

describe('suggestedExtension', () => {
  it('asks for time to answer an open Office Action', () => {
    expect(suggestedExtension(mark())).toEqual({ purpose: 'oa_response', reasons: ['complexity'] });
  });
  it('is the appeal for a final rejection, granted by the Regulations', () => {
    expect(suggestedExtension(mark({ officeActions: [{ ...OA, kind: 'final_rejection' }] })))
      .toEqual({ purpose: 'appeal', reasons: ['regulations'] });
  });
  it('falls to the 3rd-year DAU once the round is extended or answered', () => {
    expect(suggestedExtension(mark({ officeActions: [{ ...OA, motex: true }] }))?.purpose).toBe('dau_3');
    expect(suggestedExtension(mark({ officeActions: [], dau3Motex: true, dau3MotexDecision: null, dau3MotexDecidedOn: null }))).toBeNull();
  });
});

describe('extensionProblems', () => {
  const input = { purpose: 'oa_response' as const, reasons: ['complexity' as const], documentNo: '2026/1', examiner: 'J. Cruz', division: 'TMED I' };
  it('has none on a complete mark before the period lapses', () => {
    expect(extensionProblems(mark(), input, '2026-10-01')).toEqual([]);
  });
  it('says when the period has already lapsed', () => {
    expect(extensionProblems(mark(), input, '2026-11-02').join(' ')).toMatch(/lapsed on 1 November 2026/);
  });
  it('says an extension is on record once a MOTEX is filed, not that the period lapsed', () => {
    const problems = extensionProblems(mark({ officeActions: [{ ...OA, motex: true }] }), input, '2026-11-15');
    expect(problems.join(' ')).toMatch(/already recorded/);
    expect(problems.join(' ')).not.toMatch(/lapsed/);
  });
  it('raises no extension on record for a round with a set period', () => {
    expect(extensionProblems(mark({ officeActions: [{ ...OA, respondBy: '2026-10-15' }] }), input, '2026-10-01')).toEqual([]);
  });
  it('says the Regulations ground is only for B, D and E', () => {
    expect(extensionProblems(mark(), { ...input, reasons: ['regulations'] }, '2026-10-01').join(' ')).toMatch(/B, D and E/);
  });
});

describe('buildExtensionRequest', () => {
  const signatory = { name: 'Juan dela Cruz', position: 'Associate' };
  const firm = { name: 'SAMPLE LAW OFFICES', addressLines: ['1 Sample Street', 'Makati City, Philippines'], email: 'ip@sample.example' };

  it('is laid out as the firm’s responses: the Director, the caption, the title, numbered statements, and Respectfully', () => {
    const ps = buildExtensionRequest(mark({ owner: 'Sample Corp' }), {
      purpose: 'oa_response', reasons: ['complexity'], documentNo: '2026/77206', examiner: 'A. Reyes', division: 'TMED I',
    }, { today: '2026-10-01', signatory, firm });
    const t = text(ps);
    expect(t).toContain('THE DIRECTOR OF TRADEMARKS\nIntellectual Property Office of the Philippines');
    expect(t).toContain('Applicant/s: Sample Corp\nMark: **SAMPLE**\nApplication No.: 4-2026-500001\nDate Filed: 1 February 2026\nClass: 21');
    expect(t).toContain('Bureau: Trademarks\nTitle: Request for Extension of Time\nDocument No.: 2026/77206\nExaminer: A. Reyes\nDivision: TMED I');
    expect(t).toContain('Request for Extension of Time (Office Action dated 1 September 2026)');
    expect(t).toContain('Applicant, through undersigned counsel, respectfully requests an extension of time in Application No. 4-2026-500001 for the mark **“SAMPLE”**');
    expect(t).toContain('1.\tOn 1 September 2026, this Honorable Office issued the *Office Action* on the application, which the Applicant received on 3 September 2026.');
    expect(t).toContain('2.\tThe period to file the Applicant’s response to the examiner’s action ends on 1 November 2026.');
    expect(t).toContain('3.\tThe Applicant respectfully requests an extension of time to file its response to the examiner’s action, until 1 January 2027, for the following reason:\nComplexity of issue');
    expect(t).toContain('5.\tAccordingly, the Applicant respectfully prays');
    expect(t.endsWith('Respectfully,\nSAMPLE LAW OFFICES\n1 Sample Street\nMakati City, Philippines\nip@sample.example\n\nBy:\nJuan dela Cruz\nAssociate')).toBe(true);
  });

  it('brackets what the notice gives for an examiner’s action, and leaves it out for a DAU', () => {
    const oa = text(buildExtensionRequest(mark(), { purpose: 'oa_response', reasons: ['complexity'] }, { today: '2026-10-01', signatory, firm }));
    expect(oa).toContain('Document No.: [Document No.]\nExaminer: [Examiner]\nDivision: [Division]');
    const dau = text(buildExtensionRequest(mark({ officeActions: [] }), { purpose: 'dau_3', reasons: ['regulations', 'documents'], otherReason: 'Client abroad' }, { today: '2026-10-29', signatory, firm }));
    expect(dau).not.toContain('Examiner');
    expect(dau).toContain('Title: Request for Extension of Time\n');
    expect(dau).toMatch(/until 1 August 2029, for the following reason\/s:\nUnavailability of document\/s\nGranted by the Trademark Regulations\nClient abroad/);
  });
});
