import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requirePortalSession } from '@/lib/portal/guards';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { logAudit, getClientIP } from '@/lib/audit';
import { generateClientUploadNotifications } from '@/lib/notifications';
import { pathsNotUnder } from '@/lib/storage/upload-path';

export const maxDuration = 60;

function sanitizeName(name: string): string {
  return name
    .replace(/[\[\](){}]/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'file';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

interface UploadDescriptor {
  name: string;
  type?: string;
}

interface ConfirmedUpload {
  name: string;
  storagePath: string;
}

/**
 * POST /api/portal/matters/[id]/files/upload
 *
 * Two-phase signed-URL upload from a client_user. A client's JWT reads and
 * writes no firm table, so everything runs on the firm-scoped service client;
 * the ownership gate is the matter read filtered to the session's client.
 *
 * Phase 1 (no `confirm`):
 *   Body: { files: [{ name, type? }], fileRequestId?: uuid }
 *   Returns: { fileNotionId, uploads: [{ name, storagePath, signedUrl, token }] }
 *
 * Phase 2 (`confirm: true`):
 *   Body: { confirm: true, fileNotionId, uploads: [{ name, storagePath }], fileRequestId?: uuid }
 *   Returns: { ok: true, fileNotionId, added }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePortalSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { id: matterId } = await params;

  const supabase = getServiceDbForFirm(session.firmId);

  // Ownership gate: the matter must belong to the session's client.
  const { data: matter } = await supabase
    .from('matters')
    .select('notion_id, name, case_title, matter_code')
    .eq('notion_id', matterId)
    .eq('client_id', session.user.clientId)
    .maybeSingle();
  if (!matter) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── Phase 2: confirm ───────────────────────────────────────────────────
  if (body.confirm) {
    const fileNotionId = typeof body.fileNotionId === 'string' ? body.fileNotionId : '';
    const uploads = Array.isArray(body.uploads) ? (body.uploads as ConfirmedUpload[]) : [];
    const fileRequestId =
      typeof body.fileRequestId === 'string' && body.fileRequestId
        ? body.fileRequestId
        : null;

    if (!fileNotionId || uploads.length === 0) {
      return NextResponse.json(
        { error: 'Missing fileNotionId or uploads' },
        { status: 400 },
      );
    }

    // If a fileRequestId is supplied, guard that it belongs to this matter
    // and is still open. A forged id from another matter is rejected. Single
    // read here covers the validation, the row's display name, and the
    // notification body.
    let requestDescription: string | undefined;
    let requestNeedsFulfillment = false;
    if (fileRequestId) {
      const { data: request } = await supabase
        .from('file_requests')
        .select('id, matter_id, fulfilled_at, canceled_at, description')
        .eq('id', fileRequestId)
        .maybeSingle();
      if (!request || request.matter_id !== matterId) {
        return NextResponse.json(
          { error: 'File request not found for this matter' },
          { status: 404 },
        );
      }
      if (request.canceled_at) {
        return NextResponse.json(
          { error: 'This request was canceled.' },
          { status: 409 },
        );
      }
      requestDescription = request.description;
      requestNeedsFulfillment = request.fulfilled_at === null;
    }

    // Phase 1 minted every path as `client-uploads/<matterId>/<fileNotionId>/…`
    // and the matter above is proven to belong to this client. Anything
    // else in the confirm payload is a path the caller chose, and the row it
    // would land in is the same row `portal/file-sign` and
    // `portal/files/download` build their allowlist from — so an unchecked
    // path here is a signed URL for someone else's object later.
    const uploadPrefix = `client-uploads/${matterId}/${fileNotionId}/`;
    const foreign = pathsNotUnder(uploads.map((u) => u.storagePath), uploadPrefix);
    if (foreign.length > 0) {
      console.error('[portal upload] rejected paths outside the upload prefix:', foreign);
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
    }

    const fileUrls = uploads.map((u) => ({
      name: u.name,
      url: '',
      path: u.storagePath,
    }));

    // Row name: when fulfilling a request, anchor on the request description
    // (truncated, single-line) so the row is identifiable as a response to
    // the ask — not just by whatever the client named the file. For free-form
    // uploads, fall back to the file name(s).
    const displayName = requestDescription
      ? truncate(requestDescription.replace(/\s+/g, ' ').trim(), 80)
      : uploads.length === 1
        ? uploads[0].name
        : `${uploads[0].name} (+${uploads.length - 1} more)`;

    const nowIso = new Date().toISOString();

    const { error: insertError } = await supabase.from('files').insert({
      notion_id: fileNotionId,
      matter_id: matterId,
      matter_name: matter.name || matter.case_title,
      name: displayName,
      origin: 'Client Upload',
      file_urls: fileUrls,
      created_time: nowIso,
      date_received: nowIso,
      uploaded_by_client_user_id: session.user.clientUserId,
      file_request_id: fileRequestId,
    });
    if (insertError) {
      console.error('[portal upload] files insert failed:', insertError);
      return NextResponse.json(
        { error: 'Failed to record uploaded files' },
        { status: 500 },
      );
    }

    // Mark the request fulfilled if it isn't already. Idempotent: the WHERE
    // `IS NULL` guard prevents a second upload against the same request from
    // overwriting the original fulfillment timestamp.
    if (fileRequestId && requestNeedsFulfillment) {
      await supabase
        .from('file_requests')
        .update({
          fulfilled_at: nowIso,
          fulfilled_by_client_user_id: session.user.clientUserId,
        })
        .eq('id', fileRequestId)
        .is('fulfilled_at', null);
    }

    logAudit({
      firmId: session.firmId,
      entityType: 'file',
      entityId: fileNotionId,
      entityName: displayName,
      action: 'client_uploaded',
      performedBy: session.user.clientUserId,
      performedByName: session.user.name || session.user.email,
      ipAddress: getClientIP(req),
    });

    // Fire-and-forget notification fan-out to assigned team. We deliberately
    // don't pass `requestDescription` here: when this is a request fulfillment,
    // `displayName` (and therefore the notification title) is already the
    // truncated description, so repeating it in the body adds nothing. The
    // body falls back to matter context.
    generateClientUploadNotifications({
      firmId: session.firmId,
      matterId,
      fileNotionId,
      fileName: displayName,
      uploaderName: session.user.name || session.user.email,
    }).catch((err) =>
      console.error('[portal upload] notification fan-out failed:', err),
    );

    return NextResponse.json({
      ok: true,
      fileNotionId,
      added: uploads.length,
    });
  }

  // ── Phase 1: mint signed upload URLs ────────────────────────────────────
  const files = Array.isArray(body.files) ? (body.files as UploadDescriptor[]) : [];
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files to upload' }, { status: 400 });
  }
  if (files.length > 20) {
    return NextResponse.json(
      { error: 'Too many files in a single upload (max 20).' },
      { status: 400 },
    );
  }

  const fileNotionId = randomUUID();

  const uploads: {
    name: string;
    storagePath: string;
    signedUrl: string;
    token: string;
  }[] = [];

  for (const f of files) {
    if (!f?.name) continue;
    const sanitized = sanitizeName(f.name);
    const storagePath = `client-uploads/${matterId}/${fileNotionId}/${sanitized}`;
    const { data, error } = await supabase.storage
      .from('files')
      .createSignedUploadUrl(storagePath);
    if (error || !data) {
      console.error('[portal upload] createSignedUploadUrl failed:', error);
      return NextResponse.json(
        { error: `Failed to prepare upload for ${f.name}` },
        { status: 500 },
      );
    }
    uploads.push({
      name: f.name,
      storagePath,
      signedUrl: data.signedUrl,
      token: data.token,
    });
  }

  if (uploads.length === 0) {
    return NextResponse.json({ error: 'No valid files' }, { status: 400 });
  }

  return NextResponse.json({ fileNotionId, uploads });
}
