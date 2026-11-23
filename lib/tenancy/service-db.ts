import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { GLOBAL_TABLES, TENANT_TABLES, TENANT_VIEWS } from './tables.generated';

/**
 * Firm-scoped facade over the service-role client. It bypasses RLS like the
 * raw client, but every tenant-table query is pinned to one firm:
 *
 *   - select / update / delete chains get `.eq('firm_id', firmId)` appended
 *     exactly once, before the caller's own filters.
 *   - insert / upsert rows are stamped with `firm_id` (a row carrying a
 *     DIFFERENT explicit firm_id throws), and an upsert `onConflict` that
 *     omits firm_id gains a `firm_id,` prefix so conflict targets stay
 *     firm-local.
 *   - tenant views get the same `.eq('firm_id', firmId)` on select, and any
 *     write through one throws. A view carries no policy of its own for the
 *     service role to skip, so its firm_id column is the only thing that pins
 *     it to a firm.
 *   - global tables pass through untouched; a name in none of the sets
 *     throws (fail closed — regenerate the registry after adding a table).
 *
 * Everything that is not `.from()` — rpc, storage, auth, channel, functions,
 * realtime — passes through to the raw client unchanged.
 */

type Row = Record<string, unknown>;

type UpsertOptions = {
  onConflict?: string;
  ignoreDuplicates?: boolean;
  count?: 'exact' | 'planned' | 'estimated';
  defaultToNull?: boolean;
};

function assertRowFirmId(row: Row, firmId: string, table: string): void {
  if (row.firm_id != null && row.firm_id !== firmId) {
    throw new Error(
      `getServiceDbForFirm: row for '${table}' carries firm_id '${String(row.firm_id)}' but the client is scoped to '${firmId}'`,
    );
  }
}

function stamped(rows: Row | Row[], firmId: string, table: string): Row | Row[] {
  const stamp = (row: Row): Row => {
    assertRowFirmId(row, firmId, table);
    return { ...row, firm_id: firmId };
  };
  return Array.isArray(rows) ? rows.map(stamp) : stamp(rows);
}

// The raw client is untyped (no Database generic), so builder methods resolve
// to loosely-typed signatures; the proxy mirrors them with unknown-based args.
/* eslint-disable @typescript-eslint/no-explicit-any */

function scopedBuilder(builder: any, firmId: string, table: string): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'select') {
        return (...args: unknown[]) => target.select(...args).eq('firm_id', firmId);
      }
      if (prop === 'update') {
        return (values: Row, ...rest: unknown[]) => {
          assertRowFirmId(values, firmId, table);
          return target.update(values, ...rest).eq('firm_id', firmId);
        };
      }
      if (prop === 'delete') {
        return (...args: unknown[]) => target.delete(...args).eq('firm_id', firmId);
      }
      if (prop === 'insert') {
        return (rows: Row | Row[], ...rest: unknown[]) =>
          target.insert(stamped(rows, firmId, table), ...rest);
      }
      if (prop === 'upsert') {
        return (rows: Row | Row[], ...rest: [UpsertOptions?, ...unknown[]]) => {
          const stampedRows = stamped(rows, firmId, table);
          if (rest.length === 0) return target.upsert(stampedRows);
          const [options, ...more] = rest;
          let opts = options;
          if (opts?.onConflict) {
            const columns = opts.onConflict.split(',').map((c) => c.trim());
            if (!columns.includes('firm_id')) {
              opts = { ...opts, onConflict: `firm_id,${opts.onConflict}` };
            }
          }
          return target.upsert(stampedRows, opts, ...more);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const VIEW_WRITES = new Set(['insert', 'upsert', 'update', 'delete']);

function scopedViewBuilder(builder: any, firmId: string, view: string): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === 'select') {
        return (...args: unknown[]) => target.select(...args).eq('firm_id', firmId);
      }
      if (typeof prop === 'string' && VIEW_WRITES.has(prop)) {
        return () => {
          throw new Error(`getServiceDbForFirm: '${view}' is a view — write to its base table`);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function getServiceDbForFirm(
  firmId: string,
  client: SupabaseClient = getSupabase(),
): SupabaseClient {
  return new Proxy(client as any, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) => {
          if (TENANT_TABLES.has(table)) return scopedBuilder(target.from(table), firmId, table);
          if (TENANT_VIEWS.has(table)) return scopedViewBuilder(target.from(table), firmId, table);
          if (GLOBAL_TABLES.has(table)) return target.from(table);
          throw new Error(
            `getServiceDbForFirm: unregistered table '${table}' — regenerate lib/tenancy/tables.generated.ts`,
          );
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as SupabaseClient;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Storage object keys are firm-prefixed: `<firmId>/<path>`. Leading slashes
 * on `path` are dropped so callers can pass either 'a/b.pdf' or '/a/b.pdf'.
 */
export function firmStoragePath(firmId: string, path: string): string {
  return `${firmId}/${path.replace(/^\/+/, '')}`;
}
