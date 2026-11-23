import { describe, it, expect, vi } from 'vitest';
import { fetchAllRows, fetchAllRowsIn, idBatches } from './supabase-paginate';

function source(total: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  return vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
}

describe('fetchAllRows', () => {
  it('reads past a full page', async () => {
    const page = source(25);
    const rows = await fetchAllRows(page, 10);
    expect(rows).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(page.mock.calls).toEqual([[0, 9], [10, 19], [20, 29]]);
  });

  it('asks once more when the last page is exactly full', async () => {
    const page = source(20);
    expect(await fetchAllRows(page, 10)).toHaveLength(20);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it('returns an empty list for no rows or null data', async () => {
    expect(await fetchAllRows(source(0), 10)).toEqual([]);
    expect(await fetchAllRows(async () => ({ data: null, error: null }), 10)).toEqual([]);
  });

  it('throws the query error', async () => {
    const err = { message: 'boom' };
    await expect(fetchAllRows(async () => ({ data: null, error: err }), 10)).rejects.toBe(err);
  });
});

describe('idBatches', () => {
  it('splits into batches of at most the given size', () => {
    expect(idBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns no batches for no ids', () => {
    expect(idBatches([])).toEqual([]);
  });
});

describe('fetchAllRowsIn', () => {
  it('splits ids into batches of 100 and pages each batch', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const page = vi.fn(async (batch: string[], from: number, to: number) => ({
      data: batch.slice(from, to + 1),
      error: null,
    }));
    const rows = await fetchAllRowsIn(ids, page, 60);
    expect(rows).toEqual(ids);
    // 100 ids page as 60 + 40, the last 50 fit in one page.
    expect(page).toHaveBeenCalledTimes(5);
    expect(page.mock.calls.map(([batch, from]) => `${batch[0]}@${from}`).sort()).toEqual(
      ['id0@0', 'id0@60', 'id100@0', 'id100@60', 'id200@0'],
    );
  });

  it('makes no request for no ids', async () => {
    const page = vi.fn();
    expect(await fetchAllRowsIn([], page)).toEqual([]);
    expect(page).not.toHaveBeenCalled();
  });

  it('throws a batch error', async () => {
    const page = vi.fn(async () => ({ data: null, error: new Error('bad') }));
    await expect(fetchAllRowsIn(['a'], page)).rejects.toThrow('bad');
  });
});
