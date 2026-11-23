import { describe, it, expect } from 'vitest';
import type { Trademark, TrademarkOfficeAction } from '@/types/notion';
import { planUndo } from './undo';

function oa(p: Partial<TrademarkOfficeAction> & { id: string }): TrademarkOfficeAction {
  return {
    trademarkId: 't', kind: 'office_action', title: null, mailingDate: '2026-03-01', receivedDate: null,
    respondBy: null, motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...p,
  };
}

function tm(p: Partial<Trademark>): Trademark {
  return {
    status: 'Pending',
    filingDate: '2026-01-10', noiDate: null, noiReceivedDate: null, noiPaymentDate: null, issuanceNoticeDate: null, issuanceNoticeReceivedDate: null, issuanceFeePaidDate: null,
    publishedDate: null, oppositionFiledDate: null, regDate: null, corReportedDate: null,
    localDeadlines: [], internationalRegistrations: [], officeActions: [],
    abandonmentMailingDate: null, abandonmentReceivedDate: null, revivalFiledDate: null,
    revivalDeclined: false, revivalCount: 0, statusBeforeAbandonment: null,
    dau3FilingDate: null, dau3Motex: false, dau3MotexDecision: null, dau3MotexDecidedOn: null, dau5FilingDate: null,
    renewalFilingDate: null, renewalDauFiledDate: null, renewalDau5FiledDate: null,
    ...p,
  } as unknown as Trademark;
}

describe('planUndo', () => {
  it('takes a filing back to For Filing, or to Prelim when that is where it came from', () => {
    expect(planUndo('mark_as_filed', tm({}))).toEqual({
      ok: true,
      updates: { filing_date: null, status: 'For Filing' },
    });
    const fromPrelim = planUndo('mark_as_filed', tm({}), 'Prelim');
    expect(fromPrelim.ok && fromPrelim.updates.status).toBe('Prelim');
  });

  it('refuses to undo a step a later one rests on', () => {
    const plan = planUndo('mark_as_filed', tm({ officeActions: [oa({ id: 'a' })] }));
    expect(plan).toEqual({ ok: false, error: expect.stringContaining('Undo the Office Action first') });
    expect(planUndo('noi_received', tm({ noiDate: '2026-05-01', noiPaymentDate: '2026-05-10' })).ok).toBe(false);
    expect(planUndo('cor_received', tm({ status: 'Registered', regDate: '2020-01-01', dau5FilingDate: '2025-06-01' })).ok).toBe(false);
    expect(planUndo('published', tm({ publishedDate: '2026-06-01', oppositionFiledDate: '2026-06-20' })).ok).toBe(false);
  });

  it('takes a registration back to Pending, or to Pending - OA with a round still open', () => {
    const reg = { status: 'Registered' as const, regDate: '2026-08-01', corReportedDate: '2026-08-05' };
    expect(planUndo('cor_received', tm(reg))).toEqual({
      ok: true,
      updates: { cor_reported_date: null, reg_date: null, status: 'Pending' },
    });
    const withOa = planUndo('cor_received', tm({ ...reg, officeActions: [oa({ id: 'a' })] }));
    expect(withOa.ok && withOa.updates.status).toBe('Pending - OA');
  });

  it('removes a round and lets the status follow the rounds left open', () => {
    const first = oa({ id: 'a', responseFiledDate: '2026-04-01' });
    const second = oa({ id: 'b', mailingDate: '2026-06-01' });
    expect(planUndo('oa_received', tm({ status: 'Pending - OA', officeActions: [first, second] }), null, 'b')).toEqual({
      ok: true,
      updates: { status: 'Pending' },
      round: { id: 'b', delete: true },
    });
    expect(planUndo('oa_response_filed', tm({ officeActions: [first] }), null, 'a')).toEqual({
      ok: true,
      updates: { status: 'Pending - OA' },
      round: { id: 'a', set: { response_filed_date: null } },
    });
  });

  it('keeps a round whose response is on record, and asks which round it means', () => {
    const answered = oa({ id: 'a', responseFiledDate: '2026-04-01' });
    expect(planUndo('oa_received', tm({ officeActions: [answered] }), null, 'a')).toEqual({
      ok: false,
      error: expect.stringContaining('Undo the response first'),
    });
    expect(planUndo('oa_received', tm({ officeActions: [answered] }), null, 'nope').ok).toBe(false);
  });

  it('only undoes instructions while the mark is still For Filing', () => {
    expect(planUndo('instructions_received', tm({ status: 'For Filing', filingDate: null }))).toEqual({
      ok: true,
      updates: { status: 'Prelim' },
    });
    expect(planUndo('instructions_received', tm({})).ok).toBe(false);
  });

  it('restores an abandoned mark to what it was, or to what its record says', () => {
    const hinted = planUndo('abandon', tm({ status: 'Abandoned', filingDate: null }), 'Prelim');
    expect(hinted.ok && hinted.updates.status).toBe('Prelim');
    const stored = planUndo('abandon', tm({ status: 'Abandoned', statusBeforeAbandonment: 'Pending - OA' }));
    expect(stored.ok && stored.updates.status).toBe('Pending - OA');
    const registered = planUndo('abandon', tm({ status: 'Abandoned', regDate: '2020-01-01' }));
    expect(registered.ok && registered.updates.status).toBe('Registered');
    const filed = planUndo('abandon', tm({ status: 'Abandoned' }));
    expect(filed.ok && filed.updates.status).toBe('Pending');
    expect(planUndo('abandon', tm({})).ok).toBe(false);
  });

  it('takes back a notice of abandonment only once no revival rests on it', () => {
    const notice = { status: 'Abandoned' as const, abandonmentMailingDate: '2026-08-01', statusBeforeAbandonment: 'Pending - OA' as const };
    expect(planUndo('abandonment_notice', tm(notice))).toEqual({
      ok: true,
      updates: { status: 'Pending - OA', abandonment_mailing_date: null, abandonment_received_date: null, status_before_abandonment: null },
    });
    expect(planUndo('abandonment_notice', tm({ ...notice, revivalDeclined: true })).ok).toBe(false);
  });

  it('puts a revived mark back to abandoned', () => {
    const revived = tm({ status: 'Pending - OA', abandonmentMailingDate: '2026-08-01', revivalFiledDate: '2026-09-01', revivalCount: 1 });
    expect(planUndo('revival_filed', revived)).toEqual({
      ok: true,
      updates: { status: 'Abandoned', revival_filed_date: null, revival_count: 0 },
    });
  });

  it('asks for a restore before moving an abandoned mark’s status', () => {
    const plan = planUndo('cor_received', tm({ status: 'Abandoned', regDate: '2020-01-01' }));
    expect(plan).toEqual({ ok: false, error: expect.stringContaining('Restore the mark first') });
  });

  it('takes back a decision on an extension, and keeps the extension until the decision is undone', () => {
    const decided = tm({ status: 'Pending - OA', officeActions: [oa({ id: 'r', motex: true, motexDecision: 'denied', motexDecidedOn: '2026-04-01' })] });
    expect(planUndo('oa_motex_denied', decided, null, 'r')).toEqual({
      ok: true, updates: {}, round: { id: 'r', set: { motex_decision: null, motex_decided_on: null } },
    });
    expect(planUndo('oa_response_motex', decided, null, 'r').ok).toBe(false);
    expect(planUndo('oa_received', decided, null, 'r').ok).toBe(false);

    const dau = tm({ dau3Motex: true, dau3MotexDecision: 'granted', dau3MotexDecidedOn: '2026-04-01' });
    expect(planUndo('dau_3_motex_granted', dau)).toEqual({ ok: true, updates: { dau_3_motex_decision: null, dau_3_motex_decided_on: null } });
    expect(planUndo('dau_3_motex_filed', dau).ok).toBe(false);
  });
});
