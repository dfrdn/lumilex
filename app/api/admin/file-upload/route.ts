import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { pathsNotUnder } from '@/lib/storage/upload-path';

export const maxDuration = 60;

/**
 * The one folder this `files` row's attachments may live in. Minted in phase 1
 * and re-derived in phase 2 from the row the caller has been proven to own, so
 * a caller-named key can't be written into `file_urls` and downloaded later
 * through the normal UI.
 */
function attachmentPrefix(firmId: string, notionId: string): string {
  return firmStoragePath(firmId, `${notionId}/`);
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
 * DELETE /api/admin/file-upload
 * Remove a file from a files table row.
 *
 * Body JSON:
 *   notionId: string   — the files row
 *   fileName: string   — name of the file to remove
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Same gate as every sibling here, and as the only UI that reaches this
  // route: `AdminDataTable` on the `files` entity, under /admin, which
  // proxy.ts already limits to these roles. Without it the handler was the
  // more permissive of the two — any signed-in staff member could append to
  // or delete from any `files` row in the firm, through the service-role
  // client, with no matter-access check.
  if (!['admin', 'super_user', 'finance'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { notionId, fileName } = await req.json();

    if (!notionId || !fileName) {
      return NextResponse.json({ error: 'Missing notionId or fileName' }, { status: 400 });
    }

    const supabase = getServiceDbForFirm(session.firmId);

    const { data: row, error: fetchError } = await supabase
      .from('files')
      .select('file_urls')
      .eq('notion_id', notionId)
      .single();

    if (fetchError || !row) {
      return NextResponse.json({ error: 'File record not found' }, { status: 404 });
    }

    const existingUrls: { name: string; url: string; path?: string }[] =
      Array.isArray(row.file_urls) ? row.file_urls : [];

    const fileEntry = existingUrls.find((f) => f.name === fileName);
    if (!fileEntry) {
      return NextResponse.json({ error: 'File not found in record' }, { status: 404 });
    }

    if (fileEntry.path) {
      await supabase.storage.from('files').remove([fileEntry.path]);
    }

    const updated = existingUrls.filter((f) => f.name !== fileName);

    const { error: updateError } = await supabase
      .from('files')
      .update({ file_urls: updated })
      .eq('notion_id', notionId);

    if (updateError) {
      throw new Error(`DB update failed: ${updateError.message}`);
    }

    return NextResponse.json({ fileUrls: updated, removed: fileName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[file-upload] Delete error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/file-upload
 * Two-phase upload using signed URLs to bypass Vercel's 4.5MB body limit.
 *
 * Phase 1 — get signed URLs:
 *   Body JSON: { notionId: string, files: [{ name: string, type: string }] }
 *   Returns: { uploads: [{ name, storagePath, signedUrl, token }] }
 *
 * Phase 2 — confirm uploads (after client uploads directly to Supabase):
 *   Body JSON: { notionId: string, confirm: true, uploads: [{ name, storagePath }] }
 *   Returns: { fileUrls: [...], added: number }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Same gate as every sibling here, and as the only UI that reaches this
  // route: `AdminDataTable` on the `files` entity, under /admin, which
  // proxy.ts already limits to these roles. Without it the handler was the
  // more permissive of the two — any signed-in staff member could append to
  // or delete from any `files` row in the firm, through the service-role
  // client, with no matter-access check.
  if (!['admin', 'super_user', 'finance'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { notionId } = body;

    if (!notionId) {
      return NextResponse.json({ error: 'Missing notionId' }, { status: 400 });
    }

    const supabase = getServiceDbForFirm(session.firmId);

    // Ownership: the client is firm-scoped, so another firm's row comes back
    // empty and its notion_id stops being usable as path material.
    const { data: fileRow, error: rowError } = await supabase
      .from('files')
      .select('file_urls')
      .eq('notion_id', notionId)
      .maybeSingle();

    if (rowError || !fileRow) {
      return NextResponse.json({ error: 'File record not found' }, { status: 404 });
    }

    // Phase 2: Confirm uploads and update DB
    if (body.confirm) {
      const uploads: { name: string; storagePath: string }[] = body.uploads ?? [];
      if (uploads.length === 0) {
        return NextResponse.json({ error: 'No uploads to confirm' }, { status: 400 });
      }

      const foreign = pathsNotUnder(
        uploads.map((u) => u.storagePath),
        attachmentPrefix(session.firmId, notionId),
      );
      if (foreign.length > 0) {
        console.error('[file-upload] rejected paths outside the attachment prefix:', foreign);
        return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
      }

      const existingUrls: { name: string; url: string; path?: string }[] =
        Array.isArray(fileRow.file_urls) ? fileRow.file_urls : [];

      const merged = [...existingUrls];
      for (const upload of uploads) {
        const att = { name: upload.name, url: '', path: upload.storagePath };
        const existingIdx = merged.findIndex((f) => f.name === att.name);
        if (existingIdx >= 0) {
          merged[existingIdx] = att;
        } else {
          merged.push(att);
        }
      }

      const { error: updateError } = await supabase
        .from('files')
        .update({ file_urls: merged })
        .eq('notion_id', notionId);

      if (updateError) {
        throw new Error(`DB update failed: ${updateError.message}`);
      }

      return NextResponse.json({ fileUrls: merged, added: uploads.length });
    }

    // Phase 1: Generate signed upload URLs
    const files: { name: string; type: string }[] = body.files ?? [];
    if (files.length === 0) {
      return NextResponse.json({ error: 'Missing files' }, { status: 400 });
    }

    const uploads: { name: string; storagePath: string; signedUrl: string; token: string }[] = [];

    for (const file of files) {
      const sanitizedName = sanitizeName(file.name);
      const storagePath = `${attachmentPrefix(session.firmId, notionId)}${sanitizedName}`;

      // Remove existing file at same path (overwrite)
      await supabase.storage.from('files').remove([storagePath]);

      const { data, error } = await supabase.storage
        .from('files')
        .createSignedUploadUrl(storagePath);

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

    return NextResponse.json({ uploads });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[file-upload] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
