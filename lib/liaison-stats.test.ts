import { describe, it, expect } from 'vitest';
import { computeErrandStats } from './liaison-stats';
import type { LiaisonTask } from '@/lib/queries/liaison';

function task(overrides: Partial<LiaisonTask>): LiaisonTask {
  return {
    id: 1,
    title: 'Errand',
    purpose: '',
    description: '',
    status: 'completed',
    priority: 'normal',
    zone_id: null,
    zone_name: null,
    zone_round_trip_rate: null,
    zone_external_rate: null,
    scheduled_for: null,
    due_date: null,
    completed_at: null,
    assigned_to: 'ext-liaison',
    assigned_to_name: 'Liaison',
    assigned_by: 'partner',
    assigned_by_name: 'Partner',
    client_id: null,
    client_name: '',
    matter_id: null,
    matter_name: '',
    deliverable_id: null,
    deliverable_name: '',
    completion_note: '',
    bill_at_internal: false,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

// 30 July 2026, noon in Manila — expressed as a UTC instant so the assertions
// hold regardless of the machine running the suite.
const NOW = new Date('2026-07-30T04:00:00Z');

describe('computeErrandStats', () => {
  it('counts assigned, completed and cancelled', () => {
    const stats = computeErrandStats(
      [
        task({ status: 'completed' }),
        task({ status: 'completed' }),
        task({ status: 'pending' }),
        task({ status: 'cancelled' }),
      ],
      NOW,
    );
    expect(stats.totalAssigned).toBe(4);
    expect(stats.completed).toBe(2);
    expect(stats.cancelled).toBe(1);
  });

  it('excludes cancelled errands from the completion rate', () => {
    // 2 of 3 non-cancelled completed — the cancelled one must not drag the rate down.
    const stats = computeErrandStats(
      [
        task({ status: 'completed' }),
        task({ status: 'completed' }),
        task({ status: 'pending' }),
        task({ status: 'cancelled' }),
      ],
      NOW,
    );
    expect(stats.completionRate).toBe(67);
  });

  it('reports a 0% rate rather than dividing by zero', () => {
    expect(computeErrandStats([], NOW).completionRate).toBe(0);
    expect(computeErrandStats([task({ status: 'cancelled' })], NOW).completionRate).toBe(0);
  });

  it('builds six month buckets ending with the current month', () => {
    const stats = computeErrandStats([], NOW);
    expect(stats.monthKeys).toEqual([
      '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ]);
  });

  it('rolls month buckets across a year boundary', () => {
    const stats = computeErrandStats([], new Date('2026-01-15T04:00:00Z'));
    expect(stats.monthKeys).toEqual([
      '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01',
    ]);
  });

  it('anchors the window on the Manila month, not the server month', () => {
    // 31 July 17:00 UTC is already 1 August in Manila — the window must end on
    // August, or the current month would be missing on a UTC server.
    const stats = computeErrandStats([], new Date('2026-07-31T17:00:00Z'));
    expect(stats.monthKeys[stats.monthKeys.length - 1]).toBe('2026-08');
  });

  it('buckets completions by Manila month, not UTC month', () => {
    // 31 July 20:00 UTC is 1 August 04:00 in Manila (UTC+8) — it belongs to August.
    const stats = computeErrandStats(
      [
        task({ completed_at: '2026-07-31T20:00:00Z' }),
        task({ completed_at: '2026-07-31T04:00:00Z' }),
      ],
      new Date(2026, 7, 15),
    );
    expect(stats.completedByMonth.get('2026-07')).toBe(1);
    expect(stats.completedByMonth.get('2026-08')).toBe(1);
  });

  it('ignores completions outside the six-month window', () => {
    const stats = computeErrandStats([task({ completed_at: '2025-01-10T02:00:00Z' })], NOW);
    expect(stats.completed).toBe(1);
    expect([...stats.completedByMonth.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('counts completions in the current month', () => {
    const stats = computeErrandStats(
      [
        task({ completed_at: '2026-07-02T02:00:00Z' }),
        task({ completed_at: '2026-07-29T02:00:00Z' }),
        task({ completed_at: '2026-06-29T02:00:00Z' }),
      ],
      NOW,
    );
    expect(stats.completedThisMonth).toBe(2);
  });

  it('skips completed rows with no completed_at but still counts them', () => {
    const stats = computeErrandStats([task({ completed_at: null })], NOW);
    expect(stats.completed).toBe(1);
    expect(stats.completedThisMonth).toBe(0);
  });

  it('ranks zones by completed errands and caps the list', () => {
    const stats = computeErrandStats(
      [
        ...Array.from({ length: 3 }, () => task({ zone_name: 'BIR Makati' })),
        ...Array.from({ length: 2 }, () => task({ zone_name: 'Quezon City' })),
        task({ zone_name: 'Pasig' }),
      ],
      NOW,
      { zoneLimit: 2 },
    );
    expect(stats.topZones).toEqual([
      { label: 'BIR Makati', value: 3 },
      { label: 'Quezon City', value: 2 },
    ]);
  });

  it('labels zone-less errands and ignores non-completed ones', () => {
    const stats = computeErrandStats(
      [
        task({ zone_name: null }),
        task({ status: 'pending', zone_name: 'Pasig' }),
        task({ status: 'cancelled', zone_name: 'Pasig' }),
      ],
      NOW,
    );
    expect(stats.topZones).toEqual([{ label: 'No zone set', value: 1 }]);
  });
});
