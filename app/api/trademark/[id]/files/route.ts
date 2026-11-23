import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { signStoragePaths } from '@/lib/storage-sign';
import { rowToTrademarkFile } from '@/lib/trademark-row';
import { isTrademarkFileStep, uuidSchema } from '@/lib/validation';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// GET /api/trademark/[id]/files — list files (with signed URLs)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('trademark_files')
    .select('*')
    .eq('trademark_id', id)
    .order('uploaded_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const files = data ?? [];
  const signedMap = await signStoragePaths(
    supabase,
    'files',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    files.map((f: any) => f.storage_path as string | null),
    60 * 60,
  );
  return NextResponse.json({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    files: files.map((f: any) => ({ ...rowToTrademarkFile(f), url: signedMap.get(f.storage_path) ?? null })),
  });
}

/**
 * POST /api/trademark/[id]/files
 *
 * Two-phase, direct-to-storage upload. Phase 1 (`{ name, size }`) mints a
 * signed upload URL; the browser PUTs the file straight to Supabase Storage.
 * Phase 2 (`{ commit: true, storagePath, … }`) records the row. Either phase
 * may carry `step` (and, for an Office Action step, `officeActionId`) to file
 * the paper under its place on the timeline.
 *
 * The bytes never pass through this function. The previous multipart version
 * enforced its own 25MB ceiling, but Vercel caps a serverless request body at
 * 4.5MB and rejected anything larger at the edge — so the check below the cap
 * never ran and the real limit was silently 4.5MB.
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

  // Confirm trademark exists
  const { data: tm, error: getErr } = await supabase
    .from('trademarks').select('id').eq('id', id).single();
  if (getErr || !tm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const step = body.step ?? null;
  if (step !== null && !isTrademarkFileStep(step)) {
    return NextResponse.json({ error: 'Unknown step' }, { status: 400 });
  }
  const officeActionId = body.officeActionId ?? null;
  if (officeActionId !== null) {
    if (!uuidSchema.safeParse(officeActionId).success) return NextResponse.json({ error: 'Invalid officeActionId' }, { status: 400 });
    const { data: round } = await supabase
      .from('trademark_office_actions').select('id').eq('id', officeActionId).eq('trademark_id', id).maybeSingle();
    if (!round) return NextResponse.json({ error: 'That Office Action is not on this mark' }, { status: 400 });
  }

  const folder = firmStoragePath(session.firmId, `trademarks/${id}`);

  if (body.commit !== true) {
    const sizeBytes = Number(body.size) || 0;
    if (sizeBytes > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 413 });
    }
    const safeName = name.replace(/[^\w.\-]+/g, '_');
    const path = `${folder}/${Date.now()}_${safeName}`;
    const { data, error } = await supabase.storage.from('files').createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[trademark files] createSignedUploadUrl failed', error);
      return NextResponse.json({ error: `Failed to prepare upload for ${name}` }, { status: 500 });
    }
    return NextResponse.json({ storagePath: path, signedUrl: data.signedUrl, token: data.token });
  }

  // ── Phase 2: confirm the object landed, then record the row ──────────────
  const storagePath = String(body.storagePath ?? '');
  if (!storagePath.startsWith(`${folder}/`)) {
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

  const { data: row, error: insErr } = await supabase
    .from('trademark_files')
    .insert({
      trademark_id: id,
      name,
      storage_path: storagePath,
      mime_type: (body.mimeType as string | null) || null,
      size_bytes: Number(body.size) || null,
      uploaded_by: session.user.notionUserId,
      step,
      office_action_id: officeActionId,
    })
    .select('*')
    .single();
  if (insErr || !row) {
    // Best-effort cleanup
    await supabase.storage.from('files').remove([storagePath]);
    return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  const { data: signed } = await supabase.storage
    .from('files')
    .createSignedUrl(storagePath, 60 * 60, { download: false });

  return NextResponse.json({
    ok: true,
    file: { ...rowToTrademarkFile(row), url: signed?.signedUrl ?? null },
  });
}

// DELETE /api/trademark/[id]/files?fileId=N — remove a file
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const fileId = Number(new URL(req.url).searchParams.get('fileId'));
  if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: row } = await supabase
    .from('trademark_files')
    .select('storage_path')
    .eq('id', fileId)
    .eq('trademark_id', id)
    .single();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await supabase.storage.from('files').remove([row.storage_path]);
  await supabase.from('trademark_files').delete().eq('id', fileId);
  return NextResponse.json({ ok: true });
}
