/**
 * Map `items` through `fn` with at most `limit` calls in flight, resolving to
 * the results in input order. Use it wherever one call per row would otherwise
 * go out all at once: each API request is a function invocation and holds a
 * database connection, and the instance has few to spare (see CLAUDE.md,
 * "Connection budget").
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}
