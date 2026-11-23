import { describe, it, expect } from 'vitest';
import { buildTrademarkStatus } from './status';
import type { TrademarkLifecycle } from '@/lib/trademark-deadlines';

const blank: Omit<TrademarkLifecycle, 'status'> = {
  origin: 'national', irDate: null, designationDate: null, localDeadlines: [], internationalRegistrations: [],
  dau5DueDate: null, renewalDueDate: null, renewalDauDueDate: null, renewalDau5DueDate: null,
  filingDate: null, noiDate: null, noiPaymentDate: null, issuanceNoticeDate: null, issuanceFeePaidDate: null, officeActions: [],
  regDate: null, dau3FilingDate: null, dau3Motex: false, dau3MotexDecision: null, dau5FilingDate: null,
  renewalFilingDate: null, renewalDauFiledDate: null, renewalDau5FiledDate: null,
  abandonmentMailingDate: null, revivalFiledDate: null, revivalDeclined: false,
};
const tm = (over: Partial<Omit<TrademarkLifecycle, 'status'>> & { status?: string } = {}) => ({ status: 'Pending', ...blank, ...over });
const round = (id: string, mailingDate: string, over: Partial<TrademarkLifecycle['officeActions'][number]> = {}) =>
  ({ id, kind: 'office_action' as const, mailingDate, respondBy: null, motex: false, motexDecision: null, motexDecidedOn: null, responseFiledDate: null, ...over });
const today = '2026-10-09';

describe('buildTrademarkStatus', () => {
  it('puts an Office Action response on the application track, overdue once its bar date passes', () => {
    const s = buildTrademarkStatus(tm({ filingDate: '2025-01-10', officeActions: [round('a', '2026-06-01')] }), { today });
    const oa = s.items.find((i) => i.kind === 'OA Response')!;
    expect(oa.track).toBe('application');
    expect(oa.state).toBe('overdue');
    expect(oa.detail).toMatch(/^Extendible to /);
    expect(oa.officeAction).toEqual({ id: 'a', final: false });
    expect(s.health).toBe('red');
    expect(s.overdue).toBe(1);
    expect(s.next?.kind).toBe('OA Response');
  });

  it('counts a round whose extension is filed to the extended date, so it is not overdue at the original one', () => {
    const s = buildTrademarkStatus(tm({ filingDate: '2025-01-10', officeActions: [round('a', '2026-07-01', { motex: true })] }), { today });
    const oa = s.items.find((i) => i.kind === 'OA Response')!;
    expect(oa.dueDate).toBe('2026-11-01');
    expect(oa.state).not.toBe('overdue');
    expect(oa.detail ?? '').not.toMatch(/^Extendible to /);
  });

  it('owes a response per open round, keyed by the round so two due the same day stay apart', () => {
    const s = buildTrademarkStatus(
      tm({ officeActions: [round('a', '2026-09-01'), round('b', '2026-09-01', { kind: 'final_rejection' }), round('c', '2026-05-01', { responseFiledDate: '2026-06-01' })] }),
      { today },
    );
    const oas = s.items.filter((i) => i.kind === 'OA Response');
    expect(oas.map((i) => i.key)).toEqual(['oa-response:a', 'oa-response:b']);
    expect(oas.map((i) => i.label)).toEqual(['Office Action response', 'Final rejection — appeal or comply']);
  });

  it('reads a registered mark as ongoing, with maintenance on the compliance track', () => {
    const s = buildTrademarkStatus(tm({ status: 'Registered', filingDate: '2019-01-01', dau3FilingDate: '2021-06-01', regDate: '2020-01-01' }), { today });
    expect(s.phase).toBe('ongoing');
    expect(s.items.map((i) => i.kind)).toEqual(['5-DAU', 'Renewal']);
    expect(s.items.every((i) => i.track === 'compliance')).toBe(true);
    expect(s.items[1].detail).toMatch(/^Window opens /);
  });

  it('is amber when something falls due within 30 days', () => {
    const s = buildTrademarkStatus(tm({ issuanceNoticeDate: '2026-08-20' }), { today });
    expect(s.dueSoon).toBe(1);
    expect(s.health).toBe('amber');
  });

  it('marks open items as waiting on the client while a request to them is open', () => {
    const s = buildTrademarkStatus(tm({ filingDate: '2026-01-01' }), { today, waitingOnClient: true });
    expect(s.items[0].state).toBe('waiting_on_client');
    expect(s.health).toBe('amber');
  });

  it('owes nothing once abandoned', () => {
    const s = buildTrademarkStatus(tm({ status: 'Abandoned', officeActions: [round('a', '2026-01-01')] }), { today });
    expect(s).toMatchObject({ phase: 'dissolved', health: 'grey', items: [], next: null });
  });

  it('owes the revival after a notice of abandonment, until it is filed or declined', () => {
    const notice = tm({ status: 'Abandoned', abandonmentMailingDate: '2026-09-01' });
    const s = buildTrademarkStatus(notice, { today });
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'Revival', track: 'application', dueDate: '2026-12-01', extendedDue: null });
    expect(buildTrademarkStatus({ ...notice, revivalDeclined: true }, { today }).items).toEqual([]);
  });

  it('keys each item by kind and bar date, so a recorded step replaces rather than duplicates', () => {
    const s = buildTrademarkStatus(tm({ filingDate: '2026-01-01' }), { today });
    expect(s.items[0].key).toBe('3-dau:2029-01-01');
  });
});
