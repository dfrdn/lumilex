import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sign a list of objects in one bucket with a single Storage request.
 *
 * Storage holds a database connection for every request it serves, so signing
 * N paths as N parallel `createSignedUrl` calls opens up to N connections at
 * once. On a 60-connection instance one page render doing that is enough to
 * lock PostgREST, Auth and pg_cron out of Postgres. Sign lists through here,
 * never in a loop.
 *
 * Returns path → signed URL. A path Storage could not sign (missing object,
 * or the whole request failed) is absent from the map, so callers fall back
 * the same way they did when a single `createSignedUrl` failed.
 */
export async function signStoragePaths(
  client: Pick<SupabaseClient, 'storage'>,
  bucket: string,
  paths: ReadonlyArray<string | null | undefined>,
  expiresIn: number,
  options?: { download?: string | boolean },
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;

  const { data } = await client.storage.from(bucket).createSignedUrls(unique, expiresIn, options);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}
