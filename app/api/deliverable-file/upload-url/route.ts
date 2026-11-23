import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { verifyStorageObjects } from '@/lib/storage-verify';
import { pathsNotUnder } from '@/lib/storage/upload-path';

/** Mirrors app/api/deliverable-file/route.ts — same folder, same derivation. */
function versionPrefix(firmId: string, deliverableId: string, version: number): string {
  return firmStoragePath(firmId, `${deliverableId}/v${version}/`);
}

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

/**
 * Two-phase direct-to-storage upload for deliverable files. Phase 1 returns
 * signed upload URLs; Phase 2 inserts `deliverable_files` rows only after the
 * client confirms every PUT succeeded. This avoids orphan DB rows pointing at
 * missing storage objects (which used to surface as "corrupt" downloads).
 *
 * Phase 1 — get signed URLs:
 *   Body: { deliverableId, action?, version?, files: [{ name, size, type }] }
 *   Returns: { version, uploads: [{ storagePath, signedUrl, token, originalName }], personId }
 *
 * Phase 2 — commit after client upload succeeds:
 *   Body: { confirm: true, deliverableId, action?, version, uploads: [{ storagePath, name, size }] }
 *   Returns: { ok: true }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const body = await req.json();
    const supabase = getServiceDbForFirm(session.firmId);

    // ── Phase 2: commit uploaded files ──
    if (body.confirm) {
      const { deliverableId, action, version, uploads } = body as {
        deliverableId: string;
        action?: string | null;
        version: number;
        uploads: { storagePath: string; name: string; size: number }[];
      };

      if (!deliverableId || !version || !Array.isArray(uploads) || uploads.length === 0) {
        return NextResponse.json(
          { error: 'Missing deliverableId, version, or uploads' },
          { status: 400 },
        );
      }

      if (!(await ownedDeliverable(supabase, deliverableId))) {
        return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
      }

      // Phase 1 minted every path under this firm's folder for this
      // deliverable and version. A path outside it is one the caller picked,
      // and recording it here makes another firm's object downloadable from
      // this deliverable. Checked before the existence probe below, so a
      // refusal reveals nothing about what is in the bucket.
      const foreign = pathsNotUnder(
        uploads.map((u) => u.storagePath),
        versionPrefix(session.firmId, deliverableId, version),
      );
      if (foreign.length > 0) {
        console.error('[deliverable-file/upload-url] rejected paths outside the version prefix:', foreign);
        return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
      }

      // Verify every object actually landed in Storage before recording rows.
      // A lost PUT that still reaches this commit would otherwise create a row
      // pointing at a missing object — listable (with a browser-reported size)
      // but un-previewable and un-downloadable.
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

      const rows = uploads.map((u) => ({
        deliverable_id: deliverableId,
        version,
        file_name: u.name,
        file_url: u.storagePath,
        file_size: verified.get(u.storagePath)?.size ?? u.size,
        uploaded_by: personId,
        action: action || null,
      }));

      // Idempotent commit: a retried or duplicate confirm (keepalive resend
      // after the tab navigated away, or a re-upload that heals an orphan)
      // must not create duplicate rows. The unique index on
      // (deliverable_id, version, file_url) backs this on-conflict-do-nothing.
      const { error: insertError } = await supabase
        .from('deliverable_files')
        .upsert(rows, { onConflict: 'deliverable_id,version,file_url', ignoreDuplicates: true });
      if (insertError) {
        throw new Error(`Failed to commit files: ${insertError.message}`);
      }

      return NextResponse.json({ ok: true });
    }

    // ── Phase 1: mint signed upload URLs ──
    const { deliverableId, files, version: requestedVersion } = body as {
      deliverableId: string;
      action?: string | null;
      files: { name: string; size: number; type: string }[];
      version?: number;
    };

    if (!deliverableId || !files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: 'Missing deliverableId or files' }, { status: 400 });
    }

    if (!(await ownedDeliverable(supabase, deliverableId))) {
      return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
    }

    // Use requested version (add to existing) or determine next version number
    let nextVersion: number;
    if (requestedVersion && typeof requestedVersion === 'number') {
      nextVersion = requestedVersion;
    } else {
      const { data: existingFiles } = await supabase
        .from('deliverable_files')
        .select('version')
        .eq('deliverable_id', deliverableId)
        .order('version', { ascending: false })
        .limit(1);

      nextVersion = (existingFiles?.[0]?.version ?? 0) + 1;
    }

    const uploads: { storagePath: string; signedUrl: string; token: string; originalName: string }[] = [];

    for (const file of files) {
      // Sanitize filename for Supabase Storage
      const sanitizedName = file.name
        .replace(/[\[\](){}]/g, '')
        .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

      const storagePath = `${versionPrefix(session.firmId, deliverableId, nextVersion)}${sanitizedName}`;

      // upsert: true lets a retry overwrite a stranded object from an earlier
      // attempt whose Phase-2 commit never landed (otherwise Storage rejects
      // the path with "The resource already exists" and the file is stuck —
      // invisible without a row, yet un-replaceable).
      const { data, error } = await supabase.storage
        .from('files')
        .createSignedUploadUrl(storagePath, { upsert: true });

      if (error) {
        throw new Error(`Failed to create upload URL for ${file.name}: ${error.message}`);
      }

      uploads.push({
        storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
        originalName: file.name,
      });
    }

    return NextResponse.json({ version: nextVersion, uploads, personId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[deliverable-file/upload-url] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
