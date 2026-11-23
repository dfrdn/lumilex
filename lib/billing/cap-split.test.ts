import { describe, it, expect } from 'vitest';
import { buildLawyerBlocks, splitLineItemsAtCap, computeCapAwareFees } from '@/lib/billing/cap-split';

const entry = (date: string, decimalHours = 1, waived = false) => ({
  date,
  decimalHours,
  description: `work on ${date}`,
  waived,
});

describe('buildLawyerBlocks (no-cap path)', () => {
  it('sorts each lawyer\'s entries chronologically', () => {
    const blocks = buildLawyerBlocks([
      {
        lawyerName: 'Maria C. Reyes',
        position: 'Founding Partner',
        hourlyRate: 6000,
        entries: [
          entry('2026-06-15', 1.4, true),
          entry('2026-06-10', 3, true),
          entry('2026-06-17', 4),
          entry('2026-06-01', 2.4, true),
        ],
      },
    ]);
    expect(blocks[0].entries.map((e) => e.date)).toEqual([
      '2026-06-01', '2026-06-10', '2026-06-15', '2026-06-17',
    ]);
  });

  it('orders lawyers most-senior first', () => {
    const blocks = buildLawyerBlocks([
      { lawyerName: 'Junior', position: 'Junior Associate', hourlyRate: 4000, entries: [entry('2026-06-01')] },
      { lawyerName: 'Founder', position: 'Founding Partner', hourlyRate: 6000, entries: [entry('2026-06-02')] },
    ]);
    expect(blocks.map((b) => b.name)).toEqual(['Founder', 'Junior']);
  });
});

describe('splitLineItemsAtCap', () => {
  it('keeps per-lawyer entries chronological in the within bucket', () => {
    const { within } = splitLineItemsAtCap([
      {
        lawyerName: 'Partner',
        position: 'Partner',
        hourlyRate: 5000,
        entries: [entry('2026-06-20'), entry('2026-06-05'), entry('2026-06-12')],
      },
    ], 100);
    expect(within[0].entries.map((e) => e.date)).toEqual([
      '2026-06-05', '2026-06-12', '2026-06-20',
    ]);
  });
});

describe('splitLineItemsAtCap — waived entries', () => {
  const partner = (entries: ReturnType<typeof entry>[]) => [{
    lawyerName: 'Partner',
    position: 'Partner',
    hourlyRate: 5000,
    entries,
  }];

  it('does not consume the cap', () => {
    const { within, beyond } = splitLineItemsAtCap(partner([
      entry('2026-06-01', 3, true),
      entry('2026-06-02', 4),
    ]), 4);
    expect(within[0].entries.map((e) => e.date)).toEqual(['2026-06-01', '2026-06-02']);
    expect(beyond).toEqual([]);
  });

  it('stays in date order once the cap has been crossed', () => {
    const { within, beyond } = splitLineItemsAtCap(partner([
      entry('2026-06-01', 4),
      entry('2026-06-02', 2),
      entry('2026-06-03', 1, true),
      entry('2026-06-04', 1),
    ]), 4);
    expect(within[0].entries.map((e) => e.date)).toEqual(['2026-06-01']);
    expect(beyond[0].entries.map((e) => [e.date, e.waived])).toEqual([
      ['2026-06-02', false],
      ['2026-06-03', true],
      ['2026-06-04', false],
    ]);
  });

  it('is never charged even when it lands in the beyond bucket', () => {
    const lineItems = partner([
      entry('2026-06-01', 4),
      entry('2026-06-02', 2, true),
      entry('2026-06-03', 1),
    ]);
    const { chargedHourly, beyond } = computeCapAwareFees(lineItems, 4, 20000, []);
    expect(beyond[0].entries.filter((e) => e.waived)).toHaveLength(1);
    expect(chargedHourly).toBe(1 * 5000);
  });
});

describe('computeCapAwareFees — a cap only absorbs when there is a retainer', () => {
  const lineItems = [{
    lawyerName: 'Senior',
    position: 'Senior Associate',
    hourlyRate: 5000,
    amount: 65000, // 13h × 5000
    entries: [
      { date: '2026-06-01', decimalHours: 7, hourlyRate: 5000, waived: false },
      { date: '2026-06-02', decimalHours: 6, hourlyRate: 5000, waived: false },
    ],
  }];

  it('cap + retainer: within-cap hours absorbed, only beyond charged', () => {
    const r = computeCapAwareFees(lineItems, 10, 20000, []);
    // 10h absorbed by the ₱20k retainer; 3h × 5000 = 15,000 charged on top.
    expect(r.chargedHourly).toBe(15000);
    expect(r.legalFees).toBe(35000);
    expect(r.beyond.length).toBe(1);
  });

  it('cap but ₱0 retainer: nothing absorbed, every hour charged', () => {
    const r = computeCapAwareFees(lineItems, 10, 0, []);
    expect(r.chargedHourly).toBe(65000); // all 13h billed
    expect(r.legalFees).toBe(65000);
    expect(r.beyond.length).toBe(0);     // treated as no-cap: all in `within`
  });
});

describe('same-position tie', () => {
  const items = () => [
    { lawyerName: 'Zed Associate', position: 'Junior Associate', hourlyRate: 4000, entries: [entry('2026-06-01', 2)] },
    { lawyerName: 'Ada Associate', position: 'Junior Associate', hourlyRate: 4000, entries: [entry('2026-06-02', 2)] },
  ];

  it('orders two lawyers at the same position by name, not by arrival', () => {
    expect(buildLawyerBlocks(items()).map((b) => b.name)).toEqual(['Ada Associate', 'Zed Associate']);
  });

  it('absorbs the cap by name order too, so the result does not depend on input order', () => {
    const a = splitLineItemsAtCap(items(), 2);
    const b = splitLineItemsAtCap(items().reverse(), 2);
    expect(a.within.map((l) => l.name)).toEqual(['Ada Associate']);
    expect(b.within.map((l) => l.name)).toEqual(['Ada Associate']);
    expect(a.beyond.map((l) => l.name)).toEqual(['Zed Associate']);
  });
});
