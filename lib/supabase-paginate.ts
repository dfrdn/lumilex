import { mapLimit } from '@/lib/map-limit';

/**
 * Read every row a query matches. PostgREST returns at most 1,000 rows per
 * request and says nothing when it stops there, so any total summed over a
 * plain `select` silently goes wrong once a table outgrows the cap.
 *
 * `page(from, to)` must run the same query each time with `.range(from, to)`
 * appended, and that query must be ordered on a unique column (usually `id`):
 * Postgres gives no stable order otherwise, and pages can repeat or skip rows.
 *
 *   const rows = await fetchAllRows((from, to) =>
 *     supabase.from('invoices').select('id, total_amount').order('id').range(from, to));
 */
export const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await page(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}

/**
 * Split ids for `.in(...)` filters. Each id lands in the request URL, so a
 * list of hundreds overruns it; keep each filter to about 100.
 */
export const IN_BATCH = 100;

export function idBatches<T>(ids: T[], size = IN_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Batches read at once by `fetchAllRowsIn`. */
const IN_CONCURRENCY = 4;

/**
 * Read every row whose column is in `ids`: the ids go out in `idBatches`, a
 * few batches at once, and each batch is paged like `fetchAllRows` — so the
 * same ordering rule applies to `page`.
 *
 *   const rows = await fetchAllRowsIn(matterIds, (batch, from, to) =>
 *     supabase.from('files').select('notion_id, name').in('matter_id', batch).order('notion_id').range(from, to));
 */
export async function fetchAllRowsIn<T>(
  ids: readonly string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: (batch: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const perBatch = await mapLimit(idBatches([...ids]), IN_CONCURRENCY, (batch) =>
    fetchAllRows<T>((from, to) => page(batch, from, to), pageSize),
  );
  return perBatch.flat();
}
