import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAudit } from '@/lib/audit';
import { findClientByName, findOrCreateClientByName } from './find-or-create';

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

beforeEach(() => vi.mocked(logAudit).mockClear());

type Row = { notion_id: string; name: string; client_code: number | null };

interface SelectCall { table: string; ilike?: [string, string] }
interface InsertCall { table: string; row: Record<string, unknown> }

/**
 * Minimal stand-in for the PostgREST builder — only the chain shapes this
 * module actually uses. Records every call so the tests can assert on the
 * pattern passed to `ilike` (escaping) and on whether an insert happened.
 *
 * `rows` is returned by the first name lookup, `raceRows` by the second (the
 * re-read after a 23505). `allocCodes` feeds successive `allocate_client_code()`
 * calls; `insertError` applies to the first insert only, so the code-collision
 * retry can be observed succeeding.
 */
function fakeClient(opts: {
  rows?: Row[];
  raceRows?: Row[];
  allocCodes?: number[];
  selectError?: { message: string } | null;
  insertError?: { code?: string; message: string } | null;
}) {
  const selects: SelectCall[] = [];
  const inserts: InsertCall[] = [];
  const allocated: number[] = [];
  let lookupCount = 0;

  const client = {
    async rpc(fn: string) {
      if (fn !== 'allocate_client_code') throw new Error(`unexpected rpc: ${fn}`);
      const code = opts.allocCodes?.[allocated.length] ?? 1;
      allocated.push(code);
      return { data: code, error: null };
    },
    from(table: string) {
      return {
        select(columns: string) {
          const call: SelectCall = { table };
          void columns;
          return {
            ilike(column: string, pattern: string) {
              call.ilike = [column, pattern];
              selects.push(call);
              lookupCount += 1;
              const rows = lookupCount === 1 ? (opts.rows ?? []) : (opts.raceRows ?? []);
              return {
                limit: async () => ({ data: rows, error: opts.selectError ?? null }),
              };
            },
          };
        },
        async insert(row: Record<string, unknown>) {
          const first = inserts.length === 0;
          inserts.push({ table, row });
          return { error: first ? (opts.insertError ?? null) : null };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, selects, inserts, allocated };
}

const existing: Row = { notion_id: 'client-175', name: 'Sample Holdings Inc.', client_code: 175 };

const FIRM = '00000000-0000-4000-8000-00000000f1f1';

/** Who a mint is attributed to — required, so every call has to carry one. */
const OPTS = { firmId: FIRM, performedBy: 'person-1' };

describe('findClientByName', () => {
  it('returns null for an empty or whitespace-only name without querying', async () => {
    const { client, selects } = fakeClient({ rows: [existing] });
    expect(await findClientByName(client, '   ')).toBeNull();
    expect(selects).toHaveLength(0);
  });

  it('returns null when no client owns the name', async () => {
    const { client } = fakeClient({ rows: [] });
    expect(await findClientByName(client, 'Nobody Ltd.')).toBeNull();
  });

  it('maps a matching row and marks it as reused', async () => {
    const { client } = fakeClient({ rows: [existing] });
    expect(await findClientByName(client, 'Sample Holdings Inc.')).toEqual({
      notionId: 'client-175',
      name: 'Sample Holdings Inc.',
      clientCode: 175,
      reused: true,
    });
  });

  it('matches case-insensitively and trims surrounding whitespace', async () => {
    const { client, selects } = fakeClient({ rows: [existing] });
    const resolved = await findClientByName(client, '  SAMPLE holdings inc.  ');
    expect(resolved?.notionId).toBe('client-175');
    expect(selects[0].ilike).toEqual(['name', 'SAMPLE holdings inc.']);
  });

  it('escapes PostgREST pattern metacharacters so the match stays literal', async () => {
    const { client, selects } = fakeClient({ rows: [] });
    await findClientByName(client, 'A_B % C\\D');
    // Unescaped, `_` and `%` would make "A_B % C\D" match unrelated clients.
    expect(selects[0].ilike?.[1]).toBe('A\\_B \\% C\\\\D');
  });

  it('rejects a wildcard-only name even when the ilike prefilter over-matches', async () => {
    // PostgREST rewrites `*` → `%`, so the DB would return every client. The
    // JS normalized-equality guard must reject them all rather than binding to
    // whichever row comes back first.
    const { client } = fakeClient({ rows: [existing, { notion_id: 'x', name: 'Acme', client_code: 9 }] });
    expect(await findClientByName(client, '*')).toBeNull();
  });

  it('throws when the read itself errors instead of reporting "no client"', async () => {
    const { client } = fakeClient({ rows: [], selectError: { message: 'statement timeout' } });
    await expect(findClientByName(client, 'Sample Holdings Inc.')).rejects.toThrow(/statement timeout/);
  });
});

describe('findOrCreateClientByName', () => {
  it('reuses the existing client instead of inserting a second row', async () => {
    const { client, inserts } = fakeClient({ rows: [existing] });
    const resolved = await findOrCreateClientByName(client, client, 'Sample Holdings Inc.', OPTS);
    expect(resolved).toEqual({
      notionId: 'client-175',
      name: 'Sample Holdings Inc.',
      clientCode: 175,
      reused: true,
    });
    expect(inserts).toHaveLength(0);
  });

  it('inserts with an allocator-minted client code when no client owns the name', async () => {
    const { client, inserts } = fakeClient({ rows: [], allocCodes: [229] });
    const resolved = await findOrCreateClientByName(client, client, 'Fresh Corp.', {
      idPrefix: 'client-corp',
      ...OPTS,
    });

    expect(resolved.reused).toBe(false);
    expect(resolved.clientCode).toBe(229);
    expect(resolved.notionId).toMatch(/^client-corp-[0-9a-f-]{36}$/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({
      name: 'Fresh Corp.',
      client_code: 229,
      full_company_name: 'Fresh Corp.',
      status: 'Active',
    });
  });

  it('never derives the code from max(client_code) — the allocator is the only source', async () => {
    // A max+1 read under the caller's RLS can under-count and re-mint a used
    // code; 20260730 replaced it with allocate_client_code(). Any `clients`
    // select here other than the two name lookups means the old path is back.
    const { client, selects, allocated } = fakeClient({ rows: [], allocCodes: [42] });
    await findOrCreateClientByName(client, client, 'Allocator Only Inc.', OPTS);
    expect(allocated).toEqual([42]);
    expect(selects.every((s) => s.ilike != null)).toBe(true);
  });

  it('trims the name before inserting', async () => {
    const { client, inserts } = fakeClient({ rows: [] });
    await findOrCreateClientByName(client, client, '  Padded Corp.  ', OPTS);
    expect(inserts[0].row).toMatchObject({ name: 'Padded Corp.', full_company_name: 'Padded Corp.' });
  });

  it('honours an explicit status so a pre-incorporation placeholder is not Active', async () => {
    const { client, inserts } = fakeClient({ rows: [] });
    await findOrCreateClientByName(client, client, 'Proposed Newco Inc.', { ...OPTS, status: 'Prospective' });
    expect(inserts[0].row).toMatchObject({ status: 'Prospective' });
  });

  it('returns the winner when a concurrent insert loses the unique-index race', async () => {
    const { client } = fakeClient({
      rows: [],
      insertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "clients_name_unique_ci"',
      },
      raceRows: [{ notion_id: 'client-races', name: 'Raced Corp.', client_code: 11 }],
    });
    const resolved = await findOrCreateClientByName(client, client, 'Raced Corp.', OPTS);
    expect(resolved).toEqual({
      notionId: 'client-races',
      name: 'Raced Corp.',
      clientCode: 11,
      reused: true,
    });
  });

  it('throws on a name-collision 23505 when the re-read still finds nothing', async () => {
    const { client } = fakeClient({
      rows: [],
      insertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "clients_name_unique_ci"',
      },
      raceRows: [],
    });
    await expect(findOrCreateClientByName(client, client, 'Ghost Corp.', OPTS)).rejects.toThrow(
      /duplicate key/,
    );
  });

  it('re-allocates and retries when the collision is on client_code, not the name', async () => {
    // A code collision has no winner to hand back by name, so the by-name
    // re-read finds nothing — without the retry the caller gets a raw 500.
    const { client, inserts, allocated } = fakeClient({
      rows: [],
      raceRows: [],
      allocCodes: [230, 231],
      insertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "clients_client_code_unique"',
      },
    });
    const resolved = await findOrCreateClientByName(client, client, 'Collided Corp.', OPTS);
    expect(allocated).toEqual([230, 231]);
    expect(resolved).toMatchObject({ clientCode: 231, reused: false });
    expect(inserts).toHaveLength(2);
    expect(inserts[1].row).toMatchObject({ name: 'Collided Corp.', client_code: 231 });
  });

  it('throws on a non-unique-violation insert error', async () => {
    const { client } = fakeClient({
      rows: [],
      insertError: { code: '42501', message: 'new row violates row-level security policy' },
    });
    await expect(findOrCreateClientByName(client, client, 'Blocked Corp.', OPTS)).rejects.toThrow(
      /row-level security/,
    );
  });

  it('rejects an empty name rather than inserting a nameless client', async () => {
    const { client, inserts } = fakeClient({ rows: [] });
    await expect(findOrCreateClientByName(client, client, '   ', OPTS)).rejects.toThrow(/name is required/);
    expect(inserts).toHaveLength(0);
  });
});

describe('findOrCreateClientByName — audit', () => {
  it('records who minted the client, under its firm, so the row has a traceable origin', async () => {
    const { client } = fakeClient({ rows: [], allocCodes: [268] });
    const resolved = await findOrCreateClientByName(client, client, 'Audited Corp.', {
      firmId: FIRM,
      performedBy: 'person-7',
      ipAddress: '10.0.0.1',
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith({
      firmId: FIRM,
      entityType: 'clients',
      entityId: resolved.notionId,
      entityName: 'Audited Corp.',
      action: 'create',
      performedBy: 'person-7',
      ipAddress: '10.0.0.1',
    });
  });

  it('audits the mint that lands on the client-code retry', async () => {
    const { client } = fakeClient({
      rows: [],
      allocCodes: [230, 231],
      insertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "clients_client_code_unique"',
      },
    });
    const resolved = await findOrCreateClientByName(client, client, 'Collided Corp.', OPTS);
    expect(resolved.clientCode).toBe(231);
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAudit).mock.calls[0][0]).toMatchObject({ entityId: resolved.notionId, performedBy: 'person-1' });
  });

  it('records nothing when an existing client is reused', async () => {
    const { client } = fakeClient({ rows: [existing] });
    await findOrCreateClientByName(client, client, 'Sample Holdings Inc.', OPTS);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('records nothing when the insert fails', async () => {
    const { client } = fakeClient({
      rows: [],
      insertError: { code: '42501', message: 'new row violates row-level security policy' },
    });
    await expect(findOrCreateClientByName(client, client, 'Blocked Corp.', OPTS)).rejects.toThrow();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
