import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type { NotionFile, FileAttachment } from '@/types/notion';
import { monthRange } from '@/lib/dates';
import { signStoragePaths } from '@/lib/storage-sign';
import { fetchAllRows, fetchAllRowsIn, idBatches } from '@/lib/supabase-paginate';

function parseFileUrlsRaw(raw: unknown): FileAttachment[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

/** Batch-resolve storage paths to signed URLs for multiple file records. */
async function resolveAllFileUrls(firmId: string, rows: NotionFile[]): Promise<NotionFile[]> {
  // Collect all paths that need signing
  const allPaths: string[] = [];
  for (const row of rows) {
    for (const f of row.fileUrls) {
      if (f.path) allPaths.push(f.path);
    }
  }

  if (allPaths.length === 0) return rows; // legacy rows, no paths

  // No `download` option → inline Content-Disposition, so previews render.
  const signedMap = await signStoragePaths(getServiceDbForFirm(firmId), 'files', allPaths, 60 * 60);

  return rows.map((row) => ({
    ...row,
    fileUrls: row.fileUrls.map((f) => ({
      ...f,
      url: (f.path && signedMap.get(f.path)) || f.url,
    })),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): NotionFile {
  return {
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    matter: row.matter_name,
    matterId: row.matter_id ?? null,
    personsReadIds: row.persons_read_ids ?? [],
    fileUrls: parseFileUrlsRaw(row.file_urls),
    dateReceived: row.date_received ?? null,
    actionTaken: row.action_taken ?? null,
    actedUponByIds: row.acted_upon_by_ids ?? [],
    origin: row.origin ?? null,
  };
}

const INBOX_LIMIT = 30;

const FILE_COLS = 'notion_id, notion_url, name, matter_name, matter_id, persons_read_ids, file_urls, date_received, action_taken, acted_upon_by_ids, origin';

/** Matters the user is on. Cached per request (pass the same client to both): the New and Read tabs both need it. */
const getUserMatterIds = cache(async (userId: string, db: SupabaseClient): Promise<string[]> => {
  const rows = await fetchAllRows<{ notion_id: string }>((from, to) =>
    db
      .from('matters')
      .select('notion_id')
      .contains('team_person_ids', [userId])
      .order('notion_id')
      .range(from, to));
  return rows.map((m) => m.notion_id);
});

/**
 * The newest received files on the user's matters that `narrow` keeps, 100
 * matters per request. Each batch returns its own newest INBOX_LIMIT, so the
 * newest INBOX_LIMIT of their union is exact.
 */
async function inboxRowsOnMatters(
  userId: string,
  db: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  narrow: (query: any) => any,
  limit = INBOX_LIMIT,
  cols = FILE_COLS,
): Promise<NotionFile[]> {
  const matterIds = await getUserMatterIds(userId, db);
  if (matterIds.length === 0) return [];

  const batches = await Promise.all(
    idBatches(matterIds).map(async (ids) => {
      const { data, error } = await narrow(
        db
          .from('files')
          .select(FILE_COLS)
          .in('matter_id', ids)
          .not('date_received', 'is', null),
      )
        .order('date_received', { ascending: false })
        .limit(INBOX_LIMIT);
      if (error) throw error;
      return (data ?? []) as unknown[];
    }),
  );
  return batches
    .flat()
    .map(mapRow)
    .sort((a, b) => (b.dateReceived ?? '').localeCompare(a.dateReceived ?? ''))
    .slice(0, INBOX_LIMIT);
}

/**
 * Inbox files the user has NOT read yet. `db` decides what may be read: the
 * dashboard passes the user's own client, so RLS bounds the list. Signing
 * stays on the firm's service client.
 */
export async function getNewInboxFiles(
  firmId: string,
  userId: string,
  db: SupabaseClient = getServiceDbForFirm(firmId),
): Promise<NotionFile[]> {
  const rows = await inboxRowsOnMatters(userId, db, (q) => q.not('persons_read_ids', 'cs', `{${userId}}`));
  return resolveAllFileUrls(firmId, rows);
}

/**
 * How many inbox files the user has not read — every one, not just the tab's
 * newest thirty. Reads ids only; no links are signed.
 */
export async function countNewInboxFiles(
  firmId: string,
  userId: string,
  db: SupabaseClient = getServiceDbForFirm(firmId),
): Promise<number> {
  const matterIds = await getUserMatterIds(userId, db);
  if (matterIds.length === 0) return 0;
  const rows = await fetchAllRowsIn<{ notion_id: string }>(matterIds, (ids, from, to) =>
    db
      .from('files')
      .select('notion_id')
      .in('matter_id', ids)
      .not('date_received', 'is', null)
      .not('persons_read_ids', 'cs', `{${userId}}`)
      .order('notion_id')
      .range(from, to),
  );
  return rows.length;
}

/** Inbox files the user HAS read, limited to month-to-date by date_received */
export async function getReadInboxFiles(
  firmId: string,
  userId: string,
  db: SupabaseClient = getServiceDbForFirm(firmId),
): Promise<NotionFile[]> {
  const firstOfMonth = monthRange().start;
  const rows = await inboxRowsOnMatters(userId, db, (q) =>
    q.gte('date_received', firstOfMonth).contains('persons_read_ids', [userId]));
  return resolveAllFileUrls(firmId, rows);
}

/** Firm-wide: most recent files received (no user/matter filter) */
export async function getRecentInboxFilesFirm(firmId: string, limit = INBOX_LIMIT): Promise<NotionFile[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('files')
    .select(FILE_COLS)
    .not('date_received', 'is', null)
    .order('date_received', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return resolveAllFileUrls(firmId, (data ?? []).map(mapRow));
}
