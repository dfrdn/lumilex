import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToCorporationMeeting } from '@/lib/corporation-row';
import { validateBody, createMeetingSchema } from '@/lib/validation';
import { meetingQuorumError, meetingToColumns } from '@/lib/meetings-server';
import { logAudit, getClientIP } from '@/lib/audit';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('corporation_meetings')
    .select('*')
    .eq('corporation_id', id)
    .order('meeting_date', { ascending: false });
  return NextResponse.json({
    meetings: (data ?? []).map((r) => rowToCorporationMeeting(r as Record<string, unknown>)),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const validation = await validateBody(req, createMeetingSchema);
  if (!validation.success) return validation.response;
  const meeting = validation.data;

  const supabase = await getSupabaseServerAuthClient();

  const qErr = await meetingQuorumError(supabase, id, meeting);
  if (qErr) return NextResponse.json({ error: qErr }, { status: 400 });

  const { data, error } = await supabase
    .from('corporation_meetings')
    .insert({
      firm_id: session.firmId,
      corporation_id: id,
      ...meetingToColumns(meeting),
      created_by: session.user.notionUserId,
    })
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'meeting_created',
    newValue: [data.meeting_type, data.meeting_date].filter(Boolean).join(' — ') || undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, meeting: rowToCorporationMeeting(data as Record<string, unknown>) });
}
