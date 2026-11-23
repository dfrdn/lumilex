import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { manilaToday } from '@/lib/dates';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Upload (or replace) the executed GPOA, browser-to-storage in two phases.
 * Filing the document also flips the status to 'Filed' and stamps today's date
 * — the team's workflow treats "GPOA uploaded" as the filing event.
 *
 * Phase 1 (`{ name, size }`) mints a signed upload URL; phase 2
 * (`{ commit: true, storagePath }`) records it and files the trademark. The
 * bytes never pass through this function: Vercel caps a serverless request
 * body at 4.5MB, so the 25MB ceiling below was never actually reachable — an
 * executed GPOA over 4.5MB was rejected at the edge with no server-side trace.
 *
 * The previous file is removed only on commit, so a failed upload can't leave
 * the trademark with no GPOA at all.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: tm } = await supabase
    .from('trademarks').select('id, gpoa_file_path').eq('id', id).single();
  if (!tm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const folder = firmStoragePath(session.firmId, `trademarks/${id}`);

  if (body.commit !== true) {
    if ((Number(body.size) || 0) > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 413 });
    }
    const ext = (name.split('.').pop() || 'pdf').replace(/[^\w]+/g, '');
    const path = `${folder}/gpoa-${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage.from('files').createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[trademark gpoa] createSignedUploadUrl failed', error);
      return NextResponse.json({ error: `Failed to prepare upload for ${name}` }, { status: 500 });
    }
    return NextResponse.json({ storagePath: path, signedUrl: data.signedUrl, token: data.token });
  }

  // ── Phase 2: confirm the object landed, then file it ─────────────────────
  const storagePath = String(body.storagePath ?? '');
  if (!storagePath.startsWith(`${folder}/gpoa-`)) {
    return NextResponse.json({ error: 'storagePath does not belong to this trademark' }, { status: 400 });
  }
  const objectName = storagePath.slice(folder.length + 1);
  const { data: listed } = await supabase.storage.from('files').list(folder, { search: objectName });
  if (!listed?.some((o) => o.name === objectName)) {
    return NextResponse.json(
      { error: 'The upload did not complete — the file was not found in storage.' },
      { status: 409 },
    );
  }

  // Swap only once the replacement is safely in place.
  if (tm.gpoa_file_path && tm.gpoa_file_path !== storagePath) {
    await supabase.storage.from('files').remove([tm.gpoa_file_path]);
  }

  const today = manilaToday();
  const { error: updErr } = await supabase
    .from('trademarks')
    .update({
      gpoa_file_path: storagePath,
      gpoa_filed_date: today,
      gpoa_status: 'Filed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const { data: signed } = await supabase.storage
    .from('files')
    .createSignedUrl(storagePath, 60 * 60, { download: false });

  return NextResponse.json({
    ok: true,
    gpoaFilePath: storagePath,
    gpoaFiledDate: today,
    url: signed?.signedUrl ?? null,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getServiceDbForFirm(session.firmId);
  const { data: tm } = await supabase
    .from('trademarks').select('gpoa_file_path').eq('id', id).single();
  if (tm?.gpoa_file_path) {
    await supabase.storage.from('files').remove([tm.gpoa_file_path]);
  }
  await supabase
    .from('trademarks')
    .update({
      gpoa_file_path: null,
      gpoa_filed_date: null,
      gpoa_status: 'To Follow',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  return NextResponse.json({ ok: true });
}
