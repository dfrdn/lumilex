import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { logAudit, getClientIP } from '@/lib/audit';
import { pathsNotUnder } from '@/lib/storage/upload-path';

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The folder one bulk-created `files` row's attachment lives in. The row
 * doesn't exist yet at confirm time, so `notionId` is the id phase 1 minted and
 * echoed back — which makes the firm segment, not the entity id, the thing that
 * keeps the key inside the caller's own storage. Phase 1 mints these; anything
 * else in the confirm payload is a key the caller picked.
 */
function bulkUploadPrefix(firmId: string, notionId: string): string {
  return firmStoragePath(firmId, `${notionId}/`);
}

function sanitizeStorageName(name: string): string {
  return name
    .replace(/[\[\](){}]/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'file';
}

/**
 * Derive a row's display name from the original filename:
 *   - strip the extension
 *   - underscores → spaces
 *   - collapse repeated whitespace
 */
function deriveRowName(originalName: string): string {
  const stem = originalName.replace(/\.[^./\\]+$/, '') || originalName;
  return stem.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

interface UploadDescriptor {
  name: string;
  type?: string;
}

interface ConfirmedRow {
  notionId: string;
  name: string;
  storagePath: string;
  originalName: string;
}

/**
 * POST /api/admin/file-bulk-create
 *
 * Two-phase signed-URL upload that creates **one `files` row per file**
 * (unlike /api/admin/file-upload which appends N attachments to a single
 * existing row). Used by the "Bulk upload" entry point on the admin Files
 * page.
 *
 * Phase 1 (no `confirm`):
 *   Body: { matterId, files: [{ name, type? }] }
 *   Returns: { matterName, uploads: [{ notionId, name, storagePath, signedUrl, token }] }
 *   — `notionId` is the pre-allocated PK for the eventual row, also used as
 *     the storage folder so the file lives at `${notionId}/${sanitized}`.
 *
 * Phase 2 (`confirm: true`):
 *   Body: { confirm: true, matterId, rows: [{ notionId, name, storagePath, originalName }] }
 *   Returns: { ok: true, inserted: number }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!['admin', 'super_user', 'finance'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const matterId = typeof body.matterId === 'string' ? body.matterId : '';
  if (!matterId) {
    return NextResponse.json({ error: 'Missing matterId' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  const { data: matter, error: matterErr } = await supabase
    .from('matters')
    .select('notion_id, name, case_title')
    .eq('notion_id', matterId)
    .maybeSingle();
  if (matterErr || !matter) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
  }
  const matterName = matter.name || matter.case_title || '';

  // ── Phase 2: confirm ───────────────────────────────────────────────────
  if (body.confirm) {
    const rows = Array.isArray(body.rows) ? (body.rows as ConfirmedRow[]) : [];
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No rows to confirm' }, { status: 400 });
    }

    const forgedIds = rows.filter((r) => r?.notionId && !UUID.test(r.notionId));
    if (forgedIds.length > 0) {
      console.error('[file-bulk-create] rejected non-minted row ids:', forgedIds.map((r) => r.notionId));
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
    }

    const foreign = rows
      .filter((r) => r?.notionId)
      .flatMap((r) => pathsNotUnder([r.storagePath], bulkUploadPrefix(session.firmId, r.notionId)));
    if (foreign.length > 0) {
      console.error('[file-bulk-create] rejected paths outside the upload prefix:', foreign);
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const inserts = rows
      .filter((r) => r?.notionId && r?.storagePath && r?.originalName)
      .map((r) => ({
        notion_id: r.notionId,
        matter_id: matterId,
        matter_name: matterName,
        name: r.name || deriveRowName(r.originalName),
        origin: '',
        file_urls: [{ name: r.originalName, url: '', path: r.storagePath }],
        created_time: nowIso,
      }));

    if (inserts.length === 0) {
      return NextResponse.json({ error: 'No valid rows' }, { status: 400 });
    }

    const { error: insertErr } = await supabase.from('files').insert(inserts);
    if (insertErr) {
      console.error('[file-bulk-create] insert failed:', insertErr);
      return NextResponse.json(
        { error: `Failed to create rows: ${insertErr.message}` },
        { status: 500 },
      );
    }

    for (const row of inserts) {
      logAudit({
        firmId: session.firmId,
        entityType: 'file',
        entityId: row.notion_id,
        entityName: row.name,
        action: 'bulk_uploaded',
        performedBy: session.user.notionUserId,
        performedByName: session.user.name ?? undefined,
        ipAddress: getClientIP(req),
      });
    }

    return NextResponse.json({ ok: true, inserted: inserts.length });
  }

  // ── Phase 1: mint signed upload URLs ────────────────────────────────────
  const files = Array.isArray(body.files) ? (body.files as UploadDescriptor[]) : [];
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files to upload' }, { status: 400 });
  }
  if (files.length > 50) {
    return NextResponse.json(
      { error: 'Too many files in a single batch (max 50).' },
      { status: 400 },
    );
  }

  const uploads: {
    notionId: string;
    name: string;
    storagePath: string;
    signedUrl: string;
    token: string;
  }[] = [];

  for (const f of files) {
    if (!f?.name) continue;
    const notionId = randomUUID();
    const storagePath = `${bulkUploadPrefix(session.firmId, notionId)}${sanitizeStorageName(f.name)}`;
    const { data, error } = await supabase.storage
      .from('files')
      .createSignedUploadUrl(storagePath);
    if (error || !data) {
      console.error('[file-bulk-create] createSignedUploadUrl failed:', error);
      return NextResponse.json(
        { error: `Failed to prepare upload for ${f.name}` },
        { status: 500 },
      );
    }
    uploads.push({
      notionId,
      name: f.name,
      storagePath,
      signedUrl: data.signedUrl,
      token: data.token,
    });
  }

  if (uploads.length === 0) {
    return NextResponse.json({ error: 'No valid files' }, { status: 400 });
  }

  return NextResponse.json({ matterName, uploads });
}
