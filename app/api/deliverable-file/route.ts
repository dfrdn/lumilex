import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { verifyStorageObjects } from '@/lib/storage-verify';
import { pathsNotUnder } from '@/lib/storage/upload-path';

export const maxDuration = 60;

/**
 * The one folder a deliverable's version files may live in. Minted in phase 1
 * and re-derived in phase 2 from the deliverable the caller has just been
 * proven to own, so the two cannot drift and a supplied path naming another
 * firm's object is refused rather than signed.
 */
function versionPrefix(firmId: string, deliverableId: string, version: number): string {
  return firmStoragePath(firmId, `${deliverableId}/v${version}/`);
}

/**
 * Prove the caller's firm owns the deliverable. The client is firm-scoped, so
 * another firm's id comes back empty and the entity ids in the request stop
 * being usable as path material.
 */
async function ownedDeliverable(
  supabase: SupabaseClient,
  deliverableId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('deliverables')
    .select('notion_id')
    .eq('notion_id', deliverableId)
    .maybeSingle();
  return !!data;
}

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
};

function inferMimeType(fileName: string, providedType?: string): string {
  if (providedType && providedType !== 'application/octet-stream') return providedType;
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function sanitizeName(name: string) {
  return name
    .replace(/[\[\](){}]/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * POST /api/deliverable-file
 * Two-phase upload using signed URLs to bypass Vercel's 4.5MB body limit.
 *
 * Phase 1 — get signed URLs:
 *   Body JSON: { deliverableId, action, files: [{ name, size, type }] }
 *   Returns: { version, uploads: [{ name, storagePath, signedUrl, token }] }
 *
 * Phase 2 — confirm uploads:
 *   Body JSON: { deliverableId, action, confirm: true, version, uploads: [{ name, storagePath, size }] }
 *   Returns: { url, name, size, storagePath, version, files }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const body = await req.json();
    const { deliverableId, action } = body;

    if (!deliverableId) {
      return NextResponse.json({ error: 'Missing deliverableId' }, { status: 400 });
    }

    const supabase = getServiceDbForFirm(session.firmId);

    if (!(await ownedDeliverable(supabase, deliverableId))) {
      return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
    }

    // Phase 2: Confirm uploads and insert DB records
    if (body.confirm) {
      const uploads: { name: string; storagePath: string; size: number }[] = body.uploads ?? [];
      const version: number = body.version;

      if (uploads.length === 0 || !version) {
        return NextResponse.json({ error: 'Missing uploads or version' }, { status: 400 });
      }

      // Re-derive the folder phase 1 minted. A path outside it is a key the
      // caller chose, and it would be signed here and recorded into this
      // deliverable's files — reachable through the normal UI afterwards.
      // Refused before the existence check, so the answer says nothing about
      // whether the object is there.
      const foreign = pathsNotUnder(
        uploads.map((u) => u.storagePath),
        versionPrefix(session.firmId, deliverableId, version),
      );
      if (foreign.length > 0) {
        console.error('[deliverable-file] rejected paths outside the version prefix:', foreign);
        return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
      }

      // Verify each object exists in Storage before recording rows (see
      // lib/storage-verify) — a lost PUT must not leave a dangling row that
      // lists as a file but 404s on preview/download.
      const verified = await verifyStorageObjects(
        supabase,
        'files',
        uploads.map((u) => u.storagePath),
      );
      const missing = uploads.filter((u) => !verified.get(u.storagePath)?.exists);
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `Upload did not complete for ${missing.length} file(s): ${missing
              .map((m) => m.name)
              .join(', ')}. Please re-add and try again.`,
            missing: missing.map((m) => m.name),
          },
          { status: 422 },
        );
      }

      const results: { url: string; name: string; size: number; storagePath: string }[] = [];

      for (const upload of uploads) {
        const { data: urlData } = await supabase.storage
          .from('files')
          .createSignedUrl(upload.storagePath, 60 * 60);

        const size = verified.get(upload.storagePath)?.size ?? upload.size;
        // Idempotent: a retried commit or an orphan-healing re-upload upserts
        // onto the unique (deliverable_id, version, file_url) index rather than
        // stacking duplicate rows.
        await supabase.from('deliverable_files').upsert(
          {
            deliverable_id: deliverableId,
            version,
            file_name: upload.name,
            file_url: upload.storagePath,
            file_size: size,
            uploaded_by: personId,
            action: action || null,
          },
          { onConflict: 'deliverable_id,version,file_url', ignoreDuplicates: true },
        );

        results.push({
          url: urlData?.signedUrl ?? '',
          name: upload.name,
          size,
          storagePath: upload.storagePath,
        });
      }

      return NextResponse.json({
        url: results[0].url,
        name: results[0].name,
        size: results[0].size,
        storagePath: results[0].storagePath,
        version,
        files: results,
      });
    }

    // Phase 1: Generate signed upload URLs
    const files: { name: string; size: number; type: string }[] = body.files ?? [];
    if (files.length === 0) {
      return NextResponse.json({ error: 'Missing files' }, { status: 400 });
    }

    // Determine next version
    const { data: existingFiles } = await supabase
      .from('deliverable_files')
      .select('version')
      .eq('deliverable_id', deliverableId)
      .order('version', { ascending: false })
      .limit(1);

    const nextVersion = (existingFiles?.[0]?.version ?? 0) + 1;

    const uploads: { name: string; storagePath: string; signedUrl: string; token: string }[] = [];

    for (const file of files) {
      const sanitized = sanitizeName(file.name);
      const storagePath = `${versionPrefix(session.firmId, deliverableId, nextVersion)}${sanitized}`;

      const { data, error } = await supabase.storage
        .from('files')
        .createSignedUploadUrl(storagePath, { upsert: true });

      if (error) {
        throw new Error(`Failed to create upload URL for ${file.name}: ${error.message}`);
      }

      uploads.push({
        name: file.name,
        storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
      });
    }

    return NextResponse.json({ version: nextVersion, uploads });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[deliverable-file] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/deliverable-file
 * Edit a submission. Two-phase if replacing file.
 *
 * Without file replacement:
 *   Body JSON: { id, action }
 *
 * With file replacement — Phase 1:
 *   Body JSON: { id, action, file: { name, size, type } }
 *   Returns: { signedUrl, token, storagePath }
 *
 * With file replacement — Phase 2:
 *   Body JSON: { id, action, confirm: true, file: { name, size, storagePath } }
 */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing file id' }, { status: 400 });
    }

    const supabase = getServiceDbForFirm(session.firmId);

    const { data: existing, error: fetchError } = await supabase
      .from('deliverable_files')
      .select('*')
      .eq('id', Number(id))
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    if (existing.uploaded_by !== personId) {
      return NextResponse.json({ error: 'You can only edit your own submissions' }, { status: 403 });
    }

    // Phase 2: Confirm file replacement
    if (body.confirm && body.file) {
      const { name, size, storagePath } = body.file;

      // `existing` came back from the firm-scoped client, so its deliverable
      // and version are this firm's — re-derive the phase-1 folder from them
      // rather than trusting the path that came back.
      const foreign = pathsNotUnder(
        [storagePath],
        versionPrefix(session.firmId, existing.deliverable_id, existing.version),
      );
      if (foreign.length > 0) {
        console.error('[deliverable-file] PATCH rejected path outside the version prefix:', foreign);
        return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
      }

      const verified = await verifyStorageObjects(supabase, 'files', [storagePath]);
      if (!verified.get(storagePath)?.exists) {
        return NextResponse.json(
          { error: `Upload did not complete for ${name}. Please try again.` },
          { status: 422 },
        );
      }

      // Delete the old object, unless the replacement landed on the same key —
      // a same-named replacement would otherwise delete the file just uploaded
      // and leave the row pointing at nothing.
      if (existing.file_url && existing.file_url !== storagePath) {
        await supabase.storage.from('files').remove([existing.file_url]);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = {
        file_name: name,
        file_url: storagePath,
        file_size: size,
      };
      const changes: string[] = [`File: "${existing.file_name}" → "${name}"`];

      if (body.action !== undefined) {
        const oldAction = existing.action || '(none)';
        updates.action = body.action || null;
        changes.push(`Label: "${oldAction}" → "${body.action || '(none)'}"`);
      }

      const { error: updateError } = await supabase
        .from('deliverable_files')
        .update(updates)
        .eq('id', Number(id));

      if (updateError) {
        throw new Error(`Update failed: ${updateError.message}`);
      }

      await supabase.from('deliverable_actions').insert({
        deliverable_id: existing.deliverable_id,
        action: `Edited submission v${existing.version}`,
        old_status: '',
        new_status: '',
        performed_by: personId,
        comment: changes.join('; '),
      });

      return NextResponse.json({ ok: true });
    }

    // Phase 1: If file replacement requested, return signed URL
    if (body.file && !body.confirm) {
      const { name } = body.file;
      const sanitized = sanitizeName(name);
      const storagePath = `${versionPrefix(session.firmId, existing.deliverable_id, existing.version)}${sanitized}`;

      const { data, error } = await supabase.storage
        .from('files')
        .createSignedUploadUrl(storagePath, { upsert: true });

      if (error) {
        throw new Error(`Failed to create upload URL: ${error.message}`);
      }

      return NextResponse.json({
        signedUrl: data.signedUrl,
        token: data.token,
        storagePath,
      });
    }

    // No file replacement — just update action label
    if (body.action !== undefined) {
      const oldAction = existing.action || '(none)';
      const { error: updateError } = await supabase
        .from('deliverable_files')
        .update({ action: body.action || null })
        .eq('id', Number(id));

      if (updateError) {
        throw new Error(`Update failed: ${updateError.message}`);
      }

      await supabase.from('deliverable_actions').insert({
        deliverable_id: existing.deliverable_id,
        action: `Edited submission v${existing.version}`,
        old_status: '',
        new_status: '',
        performed_by: personId,
        comment: `Label: "${oldAction}" → "${body.action || '(none)'}"`
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[deliverable-file] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE: Remove a file or entire version group ──

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const { id, version, deliverableId } = await req.json();

    const supabase = getServiceDbForFirm(session.firmId);

    let rows: { id: number; file_url: string; file_name: string; version: number; deliverable_id: string; uploaded_by: string }[];

    if (id) {
      const { data, error } = await supabase
        .from('deliverable_files')
        .select('id, file_url, file_name, version, deliverable_id, uploaded_by')
        .eq('id', Number(id))
        .limit(1);

      if (error || !data || data.length === 0) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      rows = data;
    } else if (version !== undefined && deliverableId) {
      const { data, error } = await supabase
        .from('deliverable_files')
        .select('id, file_url, file_name, version, deliverable_id, uploaded_by')
        .eq('deliverable_id', deliverableId)
        .eq('version', Number(version));

      if (error || !data || data.length === 0) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      }
      rows = data;
    } else {
      return NextResponse.json({ error: 'Missing id or version+deliverableId' }, { status: 400 });
    }

    const unauthorized = rows.find((r) => r.uploaded_by !== personId);
    if (unauthorized) {
      return NextResponse.json({ error: 'You can only delete your own submissions' }, { status: 403 });
    }

    const delDeliverableId = rows[0].deliverable_id;
    const delVersion = rows[0].version;
    const fileNames = rows.map((r) => r.file_name);

    const storagePaths = rows.map((r) => r.file_url);
    await supabase.storage.from('files').remove(storagePaths);

    const rowIds = rows.map((r) => r.id);
    const { error: deleteError } = await supabase
      .from('deliverable_files')
      .delete()
      .in('id', rowIds);

    if (deleteError) {
      throw new Error(`Delete failed: ${deleteError.message}`);
    }

    await supabase.from('deliverable_actions').insert({
      deliverable_id: delDeliverableId,
      action: `Deleted submission v${delVersion}`,
      old_status: '',
      new_status: '',
      performed_by: personId,
      comment: `Removed: ${fileNames.join(', ')}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[deliverable-file] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
