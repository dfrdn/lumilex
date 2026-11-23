import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/enum-options', () => ({
  fetchMatterTypeCodes: async () => ({
    Retainer: 10,
    Litigation: 20,
    Incorporation: 70,
    'Post-Incorporation': 71,
    'Corporate Housekeeping': 72,
  }),
}));

import { deriveMatterCode, nextSequence } from './derive-matter-code';

const seqs = (n: number) => Array.from({ length: n }, (_, i) => `1-10-${i}`);

const FIRM = '00000000-0000-4000-8000-00000000f1f1';

type ClientRow = { notion_id: string; client_code: number } | null;

interface CountCall {
  by: 'client_id' | 'client_name';
  value: string;
  excluded?: string;
}

/**
 * Stand-in for the PostgREST builder: `clients` lookups resolve to `clientRow`,
 * the `matters` read resolves to `matterCodes`. Records how the read was
 * filtered so the tests can assert it went by client_id, not the name.
 */
function fakeClient(opts: { clientRow?: ClientRow; matterCodes?: string[] }) {
  const counts: CountCall[] = [];

  const client = {
    from(table: string) {
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: opts.clientRow ?? null }) }),
          }),
        };
      }
      const call: Partial<CountCall> = {};
      const builder = {
        eq(column: string, value: string) {
          call.by = column as CountCall['by'];
          call.value = value;
          counts.push(call as CountCall);
          return builder;
        },
        neq(_column: string, value: string) {
          call.excluded = value;
          return builder;
        },
        then(resolve: (r: { data: { matter_code: string }[] }) => unknown) {
          const data = (opts.matterCodes ?? []).map((matter_code) => ({ matter_code }));
          return Promise.resolve({ data }).then(resolve);
        },
      };
      return { select: () => builder };
    },
  } as unknown as SupabaseClient;

  return { client, counts };
}

describe('deriveMatterCode', () => {
  it('builds {clientCode}-{typeCode}-{sequence} from the client id', async () => {
    const { client, counts } = fakeClient({
      clientRow: { notion_id: 'client-226', client_code: 226 },
      matterCodes: seqs(0),
    });
    const code = await deriveMatterCode(client, FIRM, {
      clientId: 'client-226',
      type: 'Post-Incorporation',
    });
    expect(code).toBe('226-71-0');
    expect(counts[0]).toMatchObject({ by: 'client_id', value: 'client-226' });
  });

  it('gives the corporate types their registered codes rather than 0', async () => {
    const { client } = fakeClient({
      clientRow: { notion_id: 'c', client_code: 5 },
      matterCodes: seqs(2),
    });
    expect(await deriveMatterCode(client, FIRM, { clientId: 'c', type: 'Incorporation' })).toBe('5-70-2');
    expect(await deriveMatterCode(client, FIRM, { clientId: 'c', type: 'Corporate Housekeeping' })).toBe('5-72-2');
  });

  it('falls back to the client name when no id is given', async () => {
    const { client, counts } = fakeClient({
      clientRow: { notion_id: 'client-99', client_code: 99 },
      matterCodes: seqs(12),
    });
    const code = await deriveMatterCode(client, FIRM, { clientName: 'PPC Asia Corporation', type: 'Litigation' });
    expect(code).toBe('99-20-12');
    // The name only resolves the client — the count still runs by id, so legacy
    // client_name variants can't reset the sequence mid-client.
    expect(counts[0]).toMatchObject({ by: 'client_id', value: 'client-99' });
  });

  it('counts by name when the client row cannot be resolved', async () => {
    const { client, counts } = fakeClient({ clientRow: null, matterCodes: seqs(3) });
    const code = await deriveMatterCode(client, FIRM, { clientName: 'Unknown Co.', type: 'Retainer' });
    expect(code).toBe('0-10-3');
    expect(counts[0]).toMatchObject({ by: 'client_name', value: 'Unknown Co.' });
  });

  it('uses type code 0 for a type that is not registered', async () => {
    const { client } = fakeClient({ clientRow: { notion_id: 'c', client_code: 7 }, matterCodes: seqs(1) });
    expect(await deriveMatterCode(client, FIRM, { clientId: 'c', type: 'Not A Type' })).toBe('7-0-1');
  });

  it('excludes the row being re-derived from its own sequence', async () => {
    const { client, counts } = fakeClient({
      clientRow: { notion_id: 'c', client_code: 4 },
      matterCodes: seqs(6),
    });
    await deriveMatterCode(client, FIRM, { clientId: 'c', type: 'Litigation', excludeNotionId: 'matter-1' });
    expect(counts[0].excluded).toBe('matter-1');
  });
});

describe('nextSequence', () => {
  it('starts a client at 0', () => {
    expect(nextSequence([])).toBe(0);
  });

  it('goes one past the highest sequence, not the row count', () => {
    expect(nextSequence([{ matter_code: '12-40-0' }, { matter_code: '12-12-3' }])).toBe(4);
  });

  it('ignores empty and malformed codes', () => {
    expect(nextSequence([{ matter_code: null }, { matter_code: '' }, { matter_code: 'TBD' }, { matter_code: '12-40-1' }])).toBe(2);
  });
});
