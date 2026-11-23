import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { firmStoragePath, getServiceDbForFirm } from './service-db';
import { GLOBAL_TABLES, TENANT_TABLES, TENANT_VIEWS } from './tables.generated';

const FIRM = '00000000-0000-4000-8000-000000000001';
const OTHER_FIRM = '00000000-0000-4000-8000-000000000002';

type Call = { method: string; args: unknown[] };

function makeStub() {
  const calls: Call[] = [];
  const filter = {
    eq(column: string, value: unknown) {
      calls.push({ method: 'eq', args: [column, value] });
      return filter;
    },
  };
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return filter;
    };
  const builder = {
    select: record('select'),
    update: record('update'),
    delete: record('delete'),
    insert: record('insert'),
    upsert: record('upsert'),
  };
  const client = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
    rpc(...args: unknown[]) {
      calls.push({ method: 'rpc', args });
      return 'rpc-result';
    },
    storage: { marker: 'storage' },
  };
  return { calls, filter, builder, client: client as unknown as SupabaseClient };
}

describe('getServiceDbForFirm', () => {
  it('appends eq(firm_id) to tenant selects, exactly once', () => {
    const { client, calls, filter } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    const chained = db.from('matters').select('id, name').eq('status', 'Active');

    expect(chained).toBe(filter);
    expect(calls).toEqual([
      { method: 'from', args: ['matters'] },
      { method: 'select', args: ['id, name'] },
      { method: 'eq', args: ['firm_id', FIRM] },
      { method: 'eq', args: ['status', 'Active'] },
    ]);
  });

  it('passes select options through (count/head)', () => {
    const { client, calls } = makeStub();
    getServiceDbForFirm(FIRM, client).from('invoices').select('*', { count: 'exact', head: true });

    expect(calls[1]).toEqual({ method: 'select', args: ['*', { count: 'exact', head: true }] });
    expect(calls[2]).toEqual({ method: 'eq', args: ['firm_id', FIRM] });
  });

  it('appends eq(firm_id) to update and delete', () => {
    const { client, calls } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    db.from('matters').update({ status: 'Closed' });
    db.from('matters').delete();

    expect(calls).toEqual([
      { method: 'from', args: ['matters'] },
      { method: 'update', args: [{ status: 'Closed' }] },
      { method: 'eq', args: ['firm_id', FIRM] },
      { method: 'from', args: ['matters'] },
      { method: 'delete', args: [] },
      { method: 'eq', args: ['firm_id', FIRM] },
    ]);
  });

  it('injects firm_id into inserted rows (object and array)', () => {
    const { client, calls } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    db.from('invoices').insert({ amount: 100 });
    db.from('invoices').insert([{ amount: 1 }, { amount: 2, firm_id: FIRM }]);

    expect(calls[1].args[0]).toEqual({ amount: 100, firm_id: FIRM });
    expect(calls[3].args[0]).toEqual([
      { amount: 1, firm_id: FIRM },
      { amount: 2, firm_id: FIRM },
    ]);
    expect(calls.filter((c) => c.method === 'eq')).toEqual([]);
  });

  it('throws when a row carries a different explicit firm_id', () => {
    const { client } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    expect(() => db.from('invoices').insert({ firm_id: OTHER_FIRM })).toThrow(
      `row for 'invoices' carries firm_id '${OTHER_FIRM}'`,
    );
    expect(() => db.from('invoices').upsert([{ ok: 1 }, { firm_id: OTHER_FIRM }])).toThrow(
      /carries firm_id/,
    );
    expect(() => db.from('matters').update({ firm_id: OTHER_FIRM })).toThrow(/carries firm_id/);
  });

  it('prefixes firm_id onto an upsert onConflict that lacks it', () => {
    const { client, calls } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    db.from('invoices').upsert({ n: 1 }, { onConflict: 'invoice_number', ignoreDuplicates: true });
    db.from('invoices').upsert({ n: 2 }, { onConflict: 'firm_id,invoice_number' });
    db.from('invoices').upsert({ n: 3 });

    expect(calls[1].args).toEqual([
      { n: 1, firm_id: FIRM },
      { onConflict: 'firm_id,invoice_number', ignoreDuplicates: true },
    ]);
    expect(calls[3].args).toEqual([{ n: 2, firm_id: FIRM }, { onConflict: 'firm_id,invoice_number' }]);
    expect(calls[5].args).toEqual([{ n: 3, firm_id: FIRM }]);
  });

  it('passes global tables through unscoped', () => {
    const { client, calls, filter } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    const chained = db.from('firms').select('id');

    expect(chained).toBe(filter);
    expect(calls.filter((c) => c.method === 'eq')).toEqual([]);
  });

  it('scopes a view read to the firm', () => {
    const { client, calls } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    db.from('corporation_persons').select('*');
    db.from('v_deliverable_version_lookup').select('deliverable_file_id');

    expect(calls).toEqual([
      { method: 'from', args: ['corporation_persons'] },
      { method: 'select', args: ['*'] },
      { method: 'eq', args: ['firm_id', FIRM] },
      { method: 'from', args: ['v_deliverable_version_lookup'] },
      { method: 'select', args: ['deliverable_file_id'] },
      { method: 'eq', args: ['firm_id', FIRM] },
    ]);
  });

  it('refuses every write through a view', () => {
    const { client, calls } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    for (const write of ['insert', 'upsert', 'update', 'delete'] as const) {
      expect(() => (db.from('corporation_persons') as unknown as Record<string, (...a: unknown[]) => unknown>)[write]({ name: 'x' }))
        .toThrow("getServiceDbForFirm: 'corporation_persons' is a view — write to its base table");
    }
    expect(calls.filter((c) => c.method !== 'from')).toEqual([]);
  });

  it('throws on an unregistered table', () => {
    const { client } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    expect(() => db.from('mattres')).toThrow(
      "getServiceDbForFirm: unregistered table 'mattres' — regenerate lib/tenancy/tables.generated.ts",
    );
  });

  it('passes rpc and storage through to the raw client', () => {
    const { client, calls } = makeStub();
    const db = getServiceDbForFirm(FIRM, client);

    expect(db.rpc('tenant_tables')).toBe('rpc-result');
    expect(calls).toEqual([{ method: 'rpc', args: ['tenant_tables'] }]);
    expect(db.storage).toBe((client as unknown as { storage: unknown }).storage);
  });
});

describe('tables.generated registry', () => {
  it('covers the tenant surface', () => {
    expect(TENANT_TABLES.size).toBeGreaterThan(100);
    expect(TENANT_TABLES.has('matters')).toBe(true);
    expect(TENANT_TABLES.has('invoices')).toBe(true);
    expect(TENANT_TABLES.has('team')).toBe(true);
    expect(TENANT_TABLES.has('firms')).toBe(false);
    expect(TENANT_TABLES.has('ph_holidays')).toBe(false);
  });

  it('keeps the three sets disjoint', () => {
    expect(GLOBAL_TABLES.has('firms')).toBe(true);
    expect(GLOBAL_TABLES.has('firm_domains')).toBe(true);
    for (const table of GLOBAL_TABLES) expect(TENANT_TABLES.has(table)).toBe(false);
    for (const view of TENANT_VIEWS) {
      expect(TENANT_TABLES.has(view)).toBe(false);
      expect(GLOBAL_TABLES.has(view)).toBe(false);
    }
  });

  it('registers the views as firm-scoped, never global', () => {
    expect(TENANT_VIEWS.has('corporation_persons')).toBe(true);
    expect(TENANT_VIEWS.has('filings')).toBe(false);
    expect(TENANT_VIEWS.has('v_deliverable_version_lookup')).toBe(true);
  });
});

describe('firmStoragePath', () => {
  it('prefixes the firm id', () => {
    expect(firmStoragePath(FIRM, 'matters/x.pdf')).toBe(`${FIRM}/matters/x.pdf`);
  });

  it('normalizes leading slashes', () => {
    expect(firmStoragePath(FIRM, '/matters/x.pdf')).toBe(`${FIRM}/matters/x.pdf`);
    expect(firmStoragePath(FIRM, '///x.pdf')).toBe(`${FIRM}/x.pdf`);
  });
});
