import { NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';
import { isSupportedFileType } from '@/lib/ai/document-parser';
import { reviewAffidavit } from '@/lib/ai/affidavit-review';
import { verifyStorageObjects } from '@/lib/storage-verify';
import { checkPathUnder } from '@/lib/storage/upload-path';

// The review runs in after(); give the function room to finish.
export const maxDuration = 300;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'affidavit';
}

/**
 * Where an affidavit uploaded for review lands. `documents/affidavits/` used to
 * be one folder for every tenant, so the `startsWith` guard on the way back
 * proved only that the path was an affidavit upload — not whose. The firm
 * segment is what turns the same check into an ownership check.
 */
function affidavitUploadPrefix(firmId: string): string {
  return firmStoragePath(firmId, 'documents/affidavits/');
}

/** Normalize a stored file_url (which may be a full signed URL) to a bucket path. */
function toStoragePath(fileUrl: string): string {
  const m = fileUrl.match(/\/storage\/v1\/object\/(?:sign|public)\/files\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : fileUrl;
}

// ── GET: poll a single review (?id=) or list recent (?matterId=) ─────
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const personId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';
  const isPrivileged = role === 'partner' || role === 'admin' || role === 'super_user';

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const matterId = searchParams.get('matterId');
  const supabase = getServiceDbForFirm(session.firmId);

  if (id) {
    const { data, error } = await supabase
      .from('affidavit_reviews').select('*').eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (data.reviewed_by !== personId && !isPrivileged) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ review: data });
  }

  let query = supabase
    .from('affidavit_reviews')
    .select('id, matter_id, deliverable_id, file_name, mode, status, question_count, objectionable_count, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (matterId) query = query.eq('matter_id', matterId);
  else if (!isPrivileged) query = query.eq('reviewed_by', personId);

  const { data } = await query;
  return NextResponse.json({ reviews: data ?? [] });
}

// ── POST: start a review from an upload (multipart) or a deliverable file (JSON) ──
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const personId = session.user.notionUserId;
  const service = getServiceDbForFirm(session.firmId);

  let mode: 'self' | 'opposing' = 'self';
  let matterId: string | null = null;
  let deliverableId: string | null = null;
  let deliverableFileId: number | null = null;
  let source: 'upload' | 'deliverable' = 'upload';
  let fileName = 'affidavit';
  let storagePath: string | null = null;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // Phase 1 of a direct-to-storage upload: mint a signed URL and let the
  // browser PUT the affidavit straight to storage. Routing the bytes through
  // this function capped uploads at Vercel's 4.5MB request-body limit, which a
  // scanned affidavit with annexes clears easily.
  if (body.prepareUpload === true) {
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!isSupportedFileType(name)) {
      return NextResponse.json({ error: 'Unsupported file type. Upload a PDF or Word document.' }, { status: 400 });
    }
    const path = `${affidavitUploadPrefix(session.firmId)}${Date.now()}_${sanitizeName(name)}`;
    const { data, error } = await service.storage.from('files').createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[affidavit-review] createSignedUploadUrl failed', error);
      return NextResponse.json({ error: `Failed to prepare upload for ${name}` }, { status: 500 });
    }
    return NextResponse.json({ storagePath: path, signedUrl: data.signedUrl, token: data.token });
  }

  try {
    if (typeof body.storagePath === 'string' && body.storagePath) {
      // Phase 2: the browser finished the upload; confirm the object landed.
      mode = body.mode === 'opposing' ? 'opposing' : 'self';
      matterId = (body.matterId as string) || null;
      deliverableId = (body.deliverableId as string) || null;
      fileName = String(body.name ?? 'affidavit');
      source = 'upload';
      const path = body.storagePath;
      storagePath = path;

      // Re-derive the folder prepareUpload minted. Checked before the existence
      // probe so a refusal says nothing about what is in the bucket.
      if (!checkPathUnder(path, affidavitUploadPrefix(session.firmId)).ok) {
        console.error('[affidavit-review] rejected path outside the affidavit upload prefix:', path);
        return NextResponse.json({ error: 'storagePath is not an affidavit upload' }, { status: 400 });
      }

      const verified = await verifyStorageObjects(service, 'files', [path]);
      if (!verified.get(path)?.exists) {
        return NextResponse.json(
          { error: 'The upload did not complete — the file was not found in storage.' },
          { status: 409 },
        );
      }
    } else {
      mode = body.mode === 'opposing' ? 'opposing' : 'self';
      deliverableId = (body.deliverableId as string) ?? null;
      deliverableFileId = (body.deliverableFileId as number) ?? null;
      matterId = (body.matterId as string) ?? null;

      if (!deliverableId) {
        return NextResponse.json({ error: 'deliverableId or a file upload is required' }, { status: 400 });
      }

      // Authorize against the deliverable via the authed client (RLS gate).
      const authed = await getSupabaseServerAuthClient();
      const { data: deliv } = await authed
        .from('deliverables').select('notion_id, matter_id').eq('notion_id', deliverableId).maybeSingle();
      if (!deliv) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
      matterId = matterId ?? deliv.matter_id ?? null;

      // Resolve the file version (latest, or the requested one) — service-role read.
      let fq = service.from('deliverable_files')
        .select('id, file_name, file_url, version')
        .eq('deliverable_id', deliverableId);
      if (deliverableFileId) fq = fq.eq('id', deliverableFileId);
      const { data: files } = await fq.order('version', { ascending: false }).limit(1);
      const fileRow = files?.[0];
      if (!fileRow?.file_url) {
        return NextResponse.json({ error: 'No file found on this deliverable' }, { status: 400 });
      }
      if (!isSupportedFileType(fileRow.file_name || fileRow.file_url)) {
        return NextResponse.json({ error: 'The deliverable file is not a PDF or Word document.' }, { status: 400 });
      }
      source = 'deliverable';
      fileName = fileRow.file_name || 'affidavit';
      storagePath = toStoragePath(fileRow.file_url);
      deliverableFileId = fileRow.id;
    }

    const { data: row, error: insErr } = await service
      .from('affidavit_reviews')
      .insert({
        matter_id: matterId,
        deliverable_id: deliverableId,
        deliverable_file_id: deliverableFileId,
        source,
        mode,
        file_name: fileName,
        storage_path: storagePath,
        status: 'pending',
        reviewed_by: personId,
      })
      .select('id')
      .single();
    if (insErr || !row) {
      return NextResponse.json({ error: insErr?.message ?? 'Could not start review' }, { status: 500 });
    }

    logAudit({
      firmId: session.firmId,
      entityType: 'AffidavitReview',
      entityId: String(row.id),
      action: 'created',
      performedBy: personId,
      ipAddress: getClientIP(req),
    });

    const firmId = session.firmId;
    after(async () => {
      try {
        await reviewAffidavit(row.id, firmId);
      } catch (err) {
        console.error('[affidavit-review] background processing failed:', err);
      }
    });

    return NextResponse.json({ id: row.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[affidavit-review] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
