import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToCorporationMeeting } from '@/lib/corporation-row';
import { createMeetingSchema } from '@/lib/validation';
import { meetingQuorumError, meetingToColumns } from '@/lib/meetings-server';
import { logAudit, getClientIP } from '@/lib/audit';

// Partial file/status updates accepted outside the full-editor path.
const PARTIAL_COLUMNS: Record<string, string> = {
  minutesStatus: 'minutes_status',
  minutesFilePath: 'minutes_file_path',
  attendanceSheetPath: 'attendance_sheet_path',
  recordingPath: 'recording_path',
  noticeFilePath: 'notice_file_path',
  waiverOfNoticeFilePath: 'waiver_of_notice_file_path',
  proxyFilePaths: 'proxy_file_paths',
};

interface Ctx {
  params: Promise<{ id: string; meetingId: string }>;
}

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, meetingId } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('corporation_meetings')
    .select('*')
    .eq('id', meetingId)
    .eq('corporation_id', id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ meeting: rowToCorporationMeeting(data as Record<string, unknown>) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, meetingId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Full content edit from the meeting editor — validate like create.
  if ('meetingType' in body) {
    const parsed = createMeetingSchema.safeParse(body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json({ error: 'Validation failed', details }, { status: 400 });
    }
    const qErr = await meetingQuorumError(supabase, id, parsed.data);
    if (qErr) return NextResponse.json({ error: qErr }, { status: 400 });
    Object.assign(update, meetingToColumns(parsed.data));
  } else {
    // Partial file/status patch — reject anything outside the whitelist rather
    // than silently dropping it. Content edits must go through the full path above.
    const entries = Object.entries(body as Record<string, unknown>);
    const unknown = entries.filter(([k]) => !(k in PARTIAL_COLUMNS)).map(([k]) => k);
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unsupported fields for partial update: ${unknown.join(', ')}. Include meetingType to edit meeting content.` },
        { status: 400 },
      );
    }
    for (const [k, v] of entries) update[PARTIAL_COLUMNS[k]] = v;
  }

  const { data, error } = await supabase
    .from('corporation_meetings')
    .update(update)
    .eq('id', meetingId)
    .eq('corporation_id', id)
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'meeting_updated',
    fieldChanged: Object.keys(body as Record<string, unknown>).join(', '),
    newValue: [data.meeting_type, data.meeting_date].filter(Boolean).join(' — ') || undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, meeting: rowToCorporationMeeting(data as Record<string, unknown>) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, meetingId } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data: deleted, error } = await supabase
    .from('corporation_meetings')
    .delete()
    .eq('id', meetingId)
    .eq('corporation_id', id)
    .select('meeting_type, meeting_date');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = deleted?.[0];
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'meeting_deleted',
    fieldChanged: row ? [row.meeting_type, row.meeting_date].filter(Boolean).join(' — ') || undefined : undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
