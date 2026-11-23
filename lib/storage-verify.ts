import type { SupabaseClient } from '@supabase/supabase-js';

export interface VerifiedObject {
  exists: boolean;
  /** Real byte size read from storage (null if missing or unknown). */
  size: number | null;
}

/**
 * Confirm that each storage path actually has an object behind it, returning
 * the real byte size from storage.
 *
 * The deliverable upload flows are two-phase: the browser PUTs files straight
 * to Storage via signed URLs, then a separate "commit" request records the
 * `deliverable_files` rows. If a PUT is silently lost (dropped connection,
 * expired upload token, a client-side file/URL mismatch) but the commit still
 * fires, we get a row pointing at a missing object — it lists with a size (the
 * size is copied from the browser's File, not from Storage) but every
 * preview/download 404s. Call this at the commit boundary and refuse to record
 * rows for objects that aren't really there.
 */
export async function verifyStorageObjects(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<Map<string, VerifiedObject>> {
  const result = new Map<string, VerifiedObject>();

  // Group by parent folder so each folder is listed once.
  const byFolder = new Map<string, string[]>();
  for (const p of paths) {
    const slash = p.lastIndexOf('/');
    const folder = slash >= 0 ? p.slice(0, slash) : '';
    const list = byFolder.get(folder);
    if (list) list.push(p);
    else byFolder.set(folder, [p]);
  }

  await Promise.all(
    [...byFolder.entries()].map(async ([folder, folderPaths]) => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(folder, { limit: 1000 });

      const sizeByName = new Map<string, number | null>();
      if (!error && data) {
        for (const obj of data) {
          // Real files carry metadata.size; prefixes ("folders") don't.
          const size = (obj.metadata as { size?: number } | null)?.size;
          if (obj.id !== null) {
            sizeByName.set(obj.name, typeof size === 'number' ? size : null);
          }
        }
      }

      for (const p of folderPaths) {
        const name = folder ? p.slice(folder.length + 1) : p;
        const exists = sizeByName.has(name);
        result.set(p, { exists, size: exists ? sizeByName.get(name)! : null });
      }
    }),
  );

  return result;
}
