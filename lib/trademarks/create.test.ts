import { describe, expect, it } from 'vitest';
import { designationStartingPoint, startingPoint } from './create';

const TODAY = '2026-10-29';

describe('startingPoint', () => {
  it('starts a new mark before filing', () => {
    expect(startingPoint({ stage: 'new' }, TODAY)).toEqual({ row: { status: 'Prelim' }, officeAction: null });
    expect(startingPoint({ stage: 'for_filing' }, TODAY)).toEqual({ row: { status: 'For Filing' }, officeAction: null });
  });

  it('needs the filing date for a mark already filed', () => {
    expect(startingPoint({ stage: 'examination' }, TODAY)).toEqual({ error: expect.stringMatching(/filing date/) });
  });

  it('records an open Office Action with the mark', () => {
    const r = startingPoint({ stage: 'office_action', filingDate: '2026-03-01', applicationNo: ' 4-2026-1 ', oaMailingDate: '2026-09-15', oaTitle: 'Registrability Report' }, TODAY);
    expect(r).toEqual({
      row: { status: 'Pending - OA', filing_date: '2026-03-01', reg_ir_no: '4-2026-1', dau_3_filing_date: null },
      officeAction: { kind: 'office_action', title: 'Registrability Report', mailing_date: '2026-09-15', received_date: null },
    });
  });

  it('takes a registered mark with the dates its upkeep counts from', () => {
    const r = startingPoint({ stage: 'registered', filingDate: '2019-01-10', regDate: '2020-02-01', publishedDate: '2019-11-01', dau3FilingDate: '2021-12-01' }, TODAY);
    expect('row' in r && r.row).toMatchObject({ status: 'Registered', reg_date: '2020-02-01', published_date: '2019-11-01', dau_3_filing_date: '2021-12-01' });
  });

  it('ignores dates for steps after the stage', () => {
    const r = startingPoint({ stage: 'examination', filingDate: '2026-03-01', regDate: '2026-05-01', noiDate: '2026-04-01' }, TODAY);
    expect('row' in r && r.row).toEqual({ status: 'Pending', filing_date: '2026-03-01', reg_ir_no: null, dau_3_filing_date: null });
  });

  it('refuses dates that do not hold together', () => {
    expect(startingPoint({ stage: 'allowed', filingDate: '2026-03-01', noiDate: '2026-02-01' }, TODAY)).toEqual({ error: expect.stringMatching(/before the filing date/) });
    expect(startingPoint({ stage: 'published', filingDate: '2026-03-01', publishedDate: '2026-11-01' }, TODAY)).toEqual({ error: expect.stringMatching(/future/) });
    expect(startingPoint({ stage: 'office_action', filingDate: '2026-03-01', oaMailingDate: '2026-09-15', oaReceivedDate: '2026-09-10' }, TODAY))
      .toEqual({ error: expect.stringMatching(/received before/) });
  });

  it('refuses steps dated out of the order they happen', () => {
    expect(startingPoint({ stage: 'registered', filingDate: '2019-01-10', publishedDate: '2020-08-01', regDate: '2020-05-01' }, TODAY))
      .toEqual({ error: 'The registration is dated before the publication.' });
    expect(startingPoint({ stage: 'allowed', filingDate: '2026-01-10', noiDate: '2026-06-01', noiPaymentDate: '2026-05-01' }, TODAY))
      .toEqual({ error: 'The 1st publication fee payment is dated before the Notice of Allowance.' });
    expect(designationStartingPoint({ stage: 'registered', irDate: '2025-01-10', publishedDate: '2025-08-01', grantDate: '2025-06-01' }, TODAY))
      .toEqual({ error: 'The grant of protection is dated before the publication.' });
  });
});
