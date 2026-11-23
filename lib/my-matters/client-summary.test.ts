import { describe, expect, it } from 'vitest';
import { summarizeClients } from './client-summary';

const TODAY = '2026-10-14';

function matter(over: Partial<Parameters<typeof summarizeClients>[0][number]> = {}) {
  return {
    clientId: 'c1',
    clientName: 'Acme',
    status: 'Ongoing',
    lastActivityAt: '2026-10-10T03:00:00Z',
    pendingDeliverables: [],
    upcomingHearings: [],
    ...over,
  };
}

const item = (date: string | null, overdue = false) => ({ id: date ?? 'x', name: '', date, currentlyWith: [], overdue });

describe('summarizeClients', () => {
  it('rolls matters up per client', () => {
    const [c] = summarizeClients(
      [
        matter({ pendingDeliverables: [item('2026-10-01', true), item('2026-11-01')] }),
        matter({ pendingDeliverables: [item('2026-10-02', true)] }),
      ],
      TODAY,
    );
    expect(c).toMatchObject({ clientId: 'c1', matters: 2, overdue: 2, idle: 0 });
  });

  it('counts hearings up to and including the 14th day', () => {
    const [c] = summarizeClients(
      [matter({ upcomingHearings: [item('2026-10-14'), item('2026-10-28'), item('2026-10-29')] })],
      TODAY,
    );
    expect(c.hearingsSoon).toBe(2);
  });

  it('marks an ongoing matter idle at 30 Manila days, or with no activity at all', () => {
    const summary = (lastActivityAt: string | null) =>
      summarizeClients([matter({ lastActivityAt })], TODAY)[0].idle;
    expect(summary('2026-09-15T00:00:00+08:00')).toBe(0); // 29 days
    expect(summary('2026-09-14T00:00:00+08:00')).toBe(1); // 30 days
    // 2026-09-14T17:00Z is already the 15th in Manila: 29 days, not idle
    expect(summary('2026-09-14T17:00:00Z')).toBe(0);
    expect(summary(null)).toBe(1);
  });

  it('never counts a closed matter as idle', () => {
    const [c] = summarizeClients([matter({ status: 'Closed', lastActivityAt: null })], TODAY);
    expect(c.idle).toBe(0);
  });

  it('puts the clients that need a look first, then by name', () => {
    const order = summarizeClients(
      [
        matter({ clientId: 'quiet-b', clientName: 'Bravo' }),
        matter({ clientId: 'quiet-a', clientName: 'Alpha' }),
        matter({ clientId: 'idle', clientName: 'Idle Co', lastActivityAt: null }),
        matter({ clientId: 'late', clientName: 'Late Co', pendingDeliverables: [item('2026-10-01', true)] }),
      ],
      TODAY,
    ).map((c) => c.clientId);
    expect(order).toEqual(['late', 'idle', 'quiet-a', 'quiet-b']);
  });
});
