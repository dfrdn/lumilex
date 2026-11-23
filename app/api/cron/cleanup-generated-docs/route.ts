import { NextResponse } from 'next/server';
import { forEachActiveFirm } from '@/lib/tenancy/fan-out';

export const maxDuration = 120;

// Generated documents (Drafting Studio + Document Generator) that were never
// attached to a deliverable are download-only. The generations list keeps them
// reachable for a while; past this window an un-attached one is almost
// certainly abandoned, so prune the row and its storage object.
const RETENTION_DAYS = 30;

/**
 * GET|POST /api/cron/cleanup-generated-docs
 *
 * Deletes generated_documents older than RETENTION_DAYS whose file is NOT
 * referenced by any deliverable (orphans), plus their storage objects. Files
 * saved to a matter as a deliverable are never touched. Fans out per firm.
 * Auth: CRON_SECRET via `Authorization: Bearer <secret>`.
 */
export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }

async function handle(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const results = await forEachActiveFirm(async ({ db }) => {
    const { data: oldDocs, error } = await db
      .from('generated_documents')
      .select('id, storage_path, created_at')
      .lt('created_at', cutoff)
      .limit(500);
    if (error) throw new Error(error.message);
    if (!oldDocs || oldDocs.length === 0) return { scanned: 0, deleted: 0 };

    // Keep any whose file is attached to a deliverable (the durable matter copy).
    const paths = oldDocs.map((d) => d.storage_path).filter((p): p is string => !!p);
    const attached = new Set<string>();
    for (let from = 0; from < paths.length; from += 1000) {
      const slice = paths.slice(from, from + 1000);
      const { data: dfRows } = await db.from('deliverable_files').select('file_url').in('file_url', slice);
      for (const r of dfRows ?? []) if (r.file_url) attached.add(r.file_url);
    }

    const orphans = oldDocs.filter((d) => d.storage_path && !attached.has(d.storage_path));
    if (orphans.length === 0) return { scanned: oldDocs.length, deleted: 0 };

    // Remove the storage objects first, then their log rows.
    const objectPaths = orphans.map((d) => d.storage_path as string);
    const { error: rmErr } = await db.storage.from('files').remove(objectPaths);
    if (rmErr) console.error('[cleanup-generated-docs] storage remove error:', rmErr.message);

    const { error: delErr } = await db
      .from('generated_documents')
      .delete()
      .in('id', orphans.map((d) => d.id));
    if (delErr) throw new Error(delErr.message);

    return { scanned: oldDocs.length, deleted: orphans.length };
  });

  const totals = results.reduce(
    (acc, r) => ({
      scanned: acc.scanned + (r.result?.scanned ?? 0),
      deleted: acc.deleted + (r.result?.deleted ?? 0),
    }),
    { scanned: 0, deleted: 0 },
  );
  console.log(`[cleanup-generated-docs] Pruned ${totals.deleted} orphaned generated doc(s) older than ${RETENTION_DAYS}d (scanned ${totals.scanned}).`);
  return NextResponse.json({ ...totals, retentionDays: RETENTION_DAYS, firms: results });
}
