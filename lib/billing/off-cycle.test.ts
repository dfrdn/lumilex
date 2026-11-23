import { describe, it, expect } from 'vitest';
import { dropClaimedFeeLines, generationStalled, GENERATION_STALE_MS, resolveOffCycleLines, type ClientMatter, type OutstandingFee } from './off-cycle';
import { defaultPeriodLabel, offCycleTotal } from './off-cycle-label';
import { invoicePeriodDisplay } from './letter-format';

const claims = () => ({ acceptance: new Set<string>(), milestones: new Set<number>() });

describe('dropClaimedFeeLines', () => {
  const lines = [
    { kind: 'acceptance', matterId: 'm1' },
    { kind: 'milestone', matterId: 'm1', sourceIds: [7] },
    { kind: 'action', matterId: 'm1', sourceIds: [7] },
    { kind: 'retainer', matterId: 'm1' },
  ];

  it('keeps everything when nothing is claimed', () => {
    expect(dropClaimedFeeLines(lines, claims())).toHaveLength(4);
  });

  it('drops only the one-time fees another bill holds', () => {
    const c = claims();
    c.acceptance.add('m1');
    c.milestones.add(7);
    expect(dropClaimedFeeLines(lines, c).map((l) => l.kind)).toEqual(['action', 'retainer']);
  });

  it('matches on the matter, not the kind alone', () => {
    const c = claims();
    c.acceptance.add('m2');
    expect(dropClaimedFeeLines(lines, c)).toHaveLength(4);
  });
});

describe('resolveOffCycleLines', () => {
  const matters: ClientMatter[] = [
    { id: 'm1', name: 'Incorporation' },
    { id: 'm2', name: 'Arbitration' },
  ];
  const fees: OutstandingFee[] = [
    { kind: 'acceptance', matterId: 'm1', matterName: 'Incorporation', description: 'Acceptance Fee', amount: 50_000 },
    { kind: 'milestone', matterId: 'm2', matterName: 'Arbitration', description: 'Milestone — Award', amount: 10_000, milestoneId: 9 },
  ];

  it('prices one-time fees from the config, never the form', () => {
    const r = resolveOffCycleLines([{ kind: 'acceptance', matterId: 'm1' }], { matters, fees });
    expect(r).toEqual({
      ok: true,
      feeLines: [{ kind: 'acceptance', matterId: 'm1', matterName: 'Incorporation', description: 'Acceptance Fee', amount: 50_000 }],
    });
  });

  it('carries the milestone id so sending flips it invoiced', () => {
    const r = resolveOffCycleLines([{ kind: 'milestone', milestoneId: 9 }], { matters, fees });
    expect(r.ok && r.feeLines[0].sourceIds).toEqual([9]);
  });

  it('refuses a fee that is no longer outstanding', () => {
    const r = resolveOffCycleLines([{ kind: 'acceptance', matterId: 'm2' }], { matters, fees });
    expect(r.ok).toBe(false);
  });

  it('carries fees from several matters on one bill', () => {
    const r = resolveOffCycleLines(
      [{ kind: 'acceptance', matterId: 'm1' }, { kind: 'milestone', milestoneId: 9 }],
      { matters, fees },
    );
    expect(r.ok && r.feeLines).toHaveLength(2);
  });

  it('names an ad-hoc item’s matter, and rounds to centavos', () => {
    const r = resolveOffCycleLines([{ kind: 'adhoc', description: ' Success fee ', amount: 1234.567, matterId: 'm2' }], { matters, fees });
    expect(r).toEqual({
      ok: true,
      feeLines: [{ kind: 'adhoc', matterId: 'm2', matterName: 'Arbitration', description: 'Success fee', amount: 1234.57 }],
    });
  });

  it('takes a matterless ad-hoc item', () => {
    const r = resolveOffCycleLines([{ kind: 'adhoc', description: 'Success fee', amount: 100 }], { matters, fees });
    expect(r.ok && r.feeLines[0].matterId).toBeNull();
  });

  it('refuses an empty bill', () => {
    expect(resolveOffCycleLines([], { matters, fees }).ok).toBe(false);
  });

  it('rejects a matter belonging to another client', () => {
    const r = resolveOffCycleLines([{ kind: 'adhoc', description: 'x', amount: 1, matterId: 'other' }], { matters, fees });
    expect(r.ok).toBe(false);
  });
});

describe('defaultPeriodLabel', () => {
  it('names what the bill carries', () => {
    expect(defaultPeriodLabel([{ kind: 'acceptance', description: 'Acceptance Fee' }])).toBe('Acceptance Fee');
    expect(defaultPeriodLabel([
      { kind: 'acceptance', description: 'Acceptance Fee' },
      { kind: 'milestone', description: 'Milestone — Filing of Complaint' },
    ])).toBe('Acceptance Fee and Filing of Complaint');
  });

  it('falls back to the breakdown when the list runs long', () => {
    const lines = ['a', 'b', 'c', 'd'].map((d) => ({ kind: 'adhoc', description: d }));
    expect(defaultPeriodLabel(lines)).toBe('the fees itemized in the attached breakdown');
  });

  it('totals the fees to the centavo', () => {
    expect(offCycleTotal([{ amount: 0.1 }, { amount: 0.2 }, { amount: 100 }])).toBe(100.3);
  });
});

describe('invoicePeriodDisplay', () => {
  it('uses the month for a monthly invoice', () => {
    expect(invoicePeriodDisplay({ billing_month: '2026-10', billing_settings: {} })).toBe('October 2026');
  });

  it('uses the off-cycle label when set', () => {
    expect(invoicePeriodDisplay({ billing_month: '2026-10', billing_settings: { billingPeriodLabel: 'Acceptance Fee' } })).toBe('Acceptance Fee');
  });
});

describe('generationStalled', () => {
  const now = Date.parse('2026-10-14T08:00:00Z');
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it('flags an approved request still generating long after the function could have run', () => {
    expect(generationStalled({ status: 'approved', invoice_gen_status: 'pending', updated_at: at(GENERATION_STALE_MS + 1) }, now)).toBe(true);
  });

  it('leaves one that may still be running, or that recorded an outcome', () => {
    expect(generationStalled({ status: 'approved', invoice_gen_status: 'pending', updated_at: at(30_000) }, now)).toBe(false);
    expect(generationStalled({ status: 'approved', invoice_gen_status: 'success', updated_at: at(GENERATION_STALE_MS * 10) }, now)).toBe(false);
    expect(generationStalled({ status: 'pending', invoice_gen_status: null, updated_at: at(GENERATION_STALE_MS * 10) }, now)).toBe(false);
  });
});
