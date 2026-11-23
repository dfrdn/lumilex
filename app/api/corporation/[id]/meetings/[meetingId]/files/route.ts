import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { rowToCorporationMeeting } from '@/lib/corporation-row';
import { logAudit, getClientIP } from '@/lib/audit';

/**
 * POST /api/corporation/[id]/meetings/[meetingId]/files
 *
 * Two-phase, direct-to-storage upload. Phase 1 (`{ name, slot }`) mints a
 * signed upload URL; the browser PUTs the file straight to Supabase Storage.
 * Phase 2 (`{ commit: true, storagePath, slot }`) points the meeting at it.
 *
 * The bytes never pass through this function: Vercel caps a serverless request
 * body at 4.5MB, and scanned attendance sheets and recordings exceed that. The
 * old multipart version was rejected at the platform edge with no server-side
 * trace.
 *
 * Slot is one of: notice | waiver | proxy | attendance | recording | minutes.
 *
 * For single-slot kinds (notice, waiver, attendance, recording, minutes) the
 * file's storage path replaces the corresponding column on corporation_meetings.
 * Uploading 'minutes' also flips minutes_status to 'For Signing', matching the
 * generate-minutes path — the user is supplying their own document to circulate.
 * For 'proxy' the path is appended to the proxy_file_paths array (since a
 * meeting can have many proxies, one per absent stockholder/director).
 */
type Slot = 'notice' | 'waiver' | 'proxy' | 'attendance' | 'recording' | 'minutes';

const SLOT_TO_COLUMN: Record<Exclude<Slot, 'proxy'>, string> = {
  notice: 'notice_file_path',
  waiver: 'waiver_of_notice_file_path',
  attendance: 'attendance_sheet_path',
  recording: 'recording_path',
  minutes: 'minutes_file_path',
};

interface Ctx {
  params: Promise<{ id: string; meetingId: string }>;
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, meetingId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const slot = (body.slot as string | null) ?? '';
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!['notice', 'waiver', 'proxy', 'attendance', 'recording', 'minutes'].includes(slot)) {
    return NextResponse.json({ error: 'invalid slot' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const folder = firmStoragePath(session.firmId, `corporations/${id}/meetings/${meetingId}/${slot}`);

  if (body.commit !== true) {
    // Phase 1: mint the signed upload URL.
    const safeName = name.replace(/[^a-zA-Z0-9 ._-]/g, '_');
    const path = `${folder}/${Date.now()}-${safeName}`;
    const { data, error } = await supabase.storage.from('files').createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[meeting files] createSignedUploadUrl failed', error);
      return NextResponse.json({ error: `Failed to prepare upload for ${name}` }, { status: 500 });
    }
    return NextResponse.json({ storagePath: path, signedUrl: data.signedUrl, token: data.token });
  }

  // ── Phase 2: confirm the object landed, then point the meeting at it ─────
  const storagePath = String(body.storagePath ?? '');
  if (!storagePath.startsWith(`${folder}/`)) {
    return NextResponse.json({ error: 'storagePath does not belong to this meeting slot' }, { status: 400 });
  }
  const objectName = storagePath.slice(folder.length + 1);
  const { data: listed } = await supabase.storage.from('files').list(folder, { search: objectName });
  if (!listed?.some((o) => o.name === objectName)) {
    return NextResponse.json(
      { error: 'The upload did not complete — the file was not found in storage.' },
      { status: 409 },
    );
  }

  let patch: Record<string, unknown>;
  if (slot === 'proxy') {
    // Append to proxy_file_paths
    const { data: existing } = await supabase
      .from('corporation_meetings')
      .select('proxy_file_paths')
      .eq('id', meetingId)
      .single();
    patch = { proxy_file_paths: [...((existing?.proxy_file_paths as string[] | null) ?? []), storagePath] };
  } else {
    patch = { [SLOT_TO_COLUMN[slot as Exclude<Slot, 'proxy'>]]: storagePath };
    if (slot === 'minutes') patch.minutes_status = 'For Signing';
  }

  const { data: updated, error: updErr } = await supabase
    .from('corporation_meetings')
    .update(patch)
    .eq('id', meetingId)
    .eq('corporation_id', id)
    .select('*')
    .single();
  if (updErr) return NextResponse.json({ error: `Update failed: ${updErr.message}` }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'meeting_file_uploaded',
    fieldChanged: slot,
    newValue: name,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({
    ok: true,
    storagePath,
    slot,
    meeting: rowToCorporationMeeting(updated as Record<string, unknown>),
  });
}
