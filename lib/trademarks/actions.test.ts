import { describe, it, expect } from 'vitest';
import { EXTENSION_DECISIONS, TRADEMARK_ACTIONS, extensionDecisionAction, extensionDecisionSpecs } from './actions';
import { NOTICE_ACTIONS, UNCONFIRMED_RECEIPT_ACTIONS, receiptDay } from './actions';

describe('extension decisions', () => {
  it('names one recorded action for each answer to each request', () => {
    expect(extensionDecisionAction('oa', 'granted')).toBe('oa_motex_granted');
    expect(extensionDecisionAction('oa', 'denied')).toBe('oa_motex_denied');
    expect(extensionDecisionAction('dau_3', 'granted')).toBe('dau_3_motex_granted');
    expect(extensionDecisionAction('dau_3', 'denied')).toBe('dau_3_motex_denied');
    for (const a of Object.keys(EXTENSION_DECISIONS)) expect(TRADEMARK_ACTIONS.has(a as never)).toBe(true);
  });

  it('offers both answers, dated by the order, naming the round', () => {
    const specs = extensionDecisionSpecs('oa', 'r1');
    expect(specs.map((s) => [s.action, s.officeActionId, s.dateMode])).toEqual([
      ['oa_motex_granted', 'r1', 'one'],
      ['oa_motex_denied', 'r1', 'one'],
    ]);
  });
});

describe('receiptDay', () => {
  it('records the day given when the receipt is confirmed', () => {
    expect(receiptDay('noi_received', '2026-11-04', undefined)).toEqual({ ok: true, received: '2026-11-04' });
    expect(receiptDay('mark_as_filed', '2026-11-04', false)).toEqual({ ok: true, received: '2026-11-04' });
  });

  it('leaves the receipt blank for each notice that allows it', () => {
    for (const action of ['noi_received', 'issuance_received', 'oa_received', 'abandonment_notice'] as const) {
      expect(receiptDay(action, '2026-11-04', true)).toEqual({ ok: true, received: null });
    }
  });

  it('refuses an unconfirmed receipt on anything else', () => {
    expect(receiptDay('protection_granted', '2026-11-04', true).ok).toBe(false);
    expect(receiptDay('mark_as_filed', '2026-11-04', true).ok).toBe(false);
  });

  it('allows it only on notices', () => {
    for (const a of UNCONFIRMED_RECEIPT_ACTIONS) expect(NOTICE_ACTIONS.has(a)).toBe(true);
  });
});
