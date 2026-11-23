import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveFeature } from '@/lib/firm/features';
import { forEachActiveFirm, forEachFirmWithFeature, type ActiveFirm } from './fan-out';

// Bare factory (no importOriginal): the real module reaches Graph, push and
// Supabase, none of which this suite has any business loading.
vi.mock('@/lib/firm/features', () => ({ resolveFeature: vi.fn() }));
const mockResolveFeature = vi.mocked(resolveFeature);

const FIRM_A: ActiveFirm = {
  id: '00000000-0000-4000-8000-00000000000a',
  slug: 'aaa-law',
  name: 'AAA Law',
  status: 'active',
};
const FIRM_B: ActiveFirm = {
  id: '00000000-0000-4000-8000-00000000000b',
  slug: 'bbb-law',
  name: 'BBB Law',
  status: 'active',
};

type Call = { table: string; method: string; args: unknown[] };

function stubClient(firms: ActiveFirm[] | null, error: { message: string } | null = null) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const record =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push({ table, method, args });
          return method === 'order' ? Promise.resolve({ data: firms, error }) : chain;
        };
      const chain: Record<string, (...args: unknown[]) => unknown> = {
        select: record('select'),
        eq: record('eq'),
        order: record('order'),
        update: record('update'),
        insert: record('insert'),
        delete: record('delete'),
        upsert: record('upsert'),
      };
      return chain;
    },
  };
  return { calls, client: client as unknown as SupabaseClient };
}

describe('forEachActiveFirm', () => {
  it('loads active firms and reports per-firm results', async () => {
    const { client, calls } = stubClient([FIRM_A, FIRM_B]);

    const results = await forEachActiveFirm(async ({ firm }) => `ran-${firm.slug}`, client);

    expect(calls.slice(0, 3)).toEqual([
      { table: 'firms', method: 'select', args: ['id, slug, name, status'] },
      { table: 'firms', method: 'eq', args: ['status', 'active'] },
      { table: 'firms', method: 'order', args: ['slug'] },
    ]);
    expect(results).toEqual([
      { firmId: FIRM_A.id, slug: 'aaa-law', ok: true, result: 'ran-aaa-law' },
      { firmId: FIRM_B.id, slug: 'bbb-law', ok: true, result: 'ran-bbb-law' },
    ]);
  });

  it('hands fn a firm-scoped db', async () => {
    const { client, calls } = stubClient([FIRM_A]);

    await forEachActiveFirm(async ({ db }) => db.from('matters').select('id'), client);

    expect(calls.filter((c) => c.table === 'matters')).toEqual([
      { table: 'matters', method: 'select', args: ['id'] },
      { table: 'matters', method: 'eq', args: ['firm_id', FIRM_A.id] },
    ]);
  });

  it('captures a per-firm failure and keeps going', async () => {
    const { client } = stubClient([FIRM_A, FIRM_B]);

    const results = await forEachActiveFirm(async ({ firm }) => {
      if (firm.slug === 'aaa-law') throw new Error('boom');
      return 'ok';
    }, client);

    expect(results).toEqual([
      { firmId: FIRM_A.id, slug: 'aaa-law', ok: false, error: 'boom' },
      { firmId: FIRM_B.id, slug: 'bbb-law', ok: true, result: 'ok' },
    ]);
  });

  it('runs firms sequentially, not concurrently', async () => {
    const { client } = stubClient([FIRM_A, FIRM_B]);
    const order: string[] = [];

    await forEachActiveFirm(async ({ firm }) => {
      order.push(`start-${firm.slug}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push(`end-${firm.slug}`);
    }, client);

    expect(order).toEqual(['start-aaa-law', 'end-aaa-law', 'start-bbb-law', 'end-bbb-law']);
  });

  it('throws when the firms query fails', async () => {
    const { client } = stubClient(null, { message: 'connection refused' });

    await expect(forEachActiveFirm(async () => 'x', client)).rejects.toThrow(
      'forEachActiveFirm: loading firms failed: connection refused',
    );
  });
});

describe('forEachFirmWithFeature', () => {
  beforeEach(() => mockResolveFeature.mockReset());

  function featureIsOnFor(...firmIds: string[]) {
    mockResolveFeature.mockImplementation(async (firmId, key) =>
      firmIds.includes(firmId)
        ? { key, available: true, reason: 'ok' }
        : { key, available: false, reason: 'not_entitled' },
    );
  }

  it('runs only the firms that have the feature', async () => {
    const { client } = stubClient([FIRM_A, FIRM_B]);
    featureIsOnFor(FIRM_A.id);

    const ran: string[] = [];
    await forEachFirmWithFeature(
      'sharepoint',
      async ({ firm }) => {
        ran.push(firm.slug);
      },
      client,
    );

    expect(ran).toEqual(['aaa-law']);
  });

  it('keeps a skipped firm visible in the results with its reason', async () => {
    const { client } = stubClient([FIRM_A, FIRM_B]);
    featureIsOnFor(FIRM_A.id);

    const results = await forEachFirmWithFeature('sharepoint', async () => 'ran', client);

    expect(results).toEqual([
      { firmId: FIRM_A.id, slug: 'aaa-law', ok: true, result: 'ran' },
      { firmId: FIRM_B.id, slug: 'bbb-law', ok: true, skipped: 'not_entitled' },
    ]);
  });

  it('never calls fn for a disabled firm', async () => {
    const { client } = stubClient([FIRM_B]);
    featureIsOnFor();
    const fn = vi.fn();

    await forEachFirmWithFeature('sharepoint', fn, client);

    expect(fn).not.toHaveBeenCalled();
  });

  it('reports a guard failure as a firm error rather than sinking the run', async () => {
    const { client } = stubClient([FIRM_A, FIRM_B]);
    mockResolveFeature.mockImplementation(async (firmId, key) => {
      if (firmId === FIRM_A.id) throw new Error('firms read failed');
      return { key, available: true, reason: 'ok' };
    });

    const results = await forEachFirmWithFeature('push', async () => 'ran', client);

    expect(results).toEqual([
      { firmId: FIRM_A.id, slug: 'aaa-law', ok: false, error: 'firms read failed' },
      { firmId: FIRM_B.id, slug: 'bbb-law', ok: true, result: 'ran' },
    ]);
  });

  it('does not consult the guard when no feature is named', async () => {
    const { client } = stubClient([FIRM_A]);

    await forEachActiveFirm(async () => 'ran', client);

    expect(mockResolveFeature).not.toHaveBeenCalled();
  });
});
