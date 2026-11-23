import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToResolution } from '@/lib/corporation-row';
import { logAudit, getClientIP } from '@/lib/audit';

interface Ctx {
  params: Promise<{ id: string; resolutionId: string }>;
}

const PATCH_COLUMNS: Record<string, string> = {
  kind: 'kind',
  title: 'title',
  dateOfResolution: 'date_of_resolution',
  templateId: 'template_id',
  variables: 'variables',
  freeFormBody: 'free_form_body',
  bundledResolutionIds: 'bundled_resolution_ids',
  meetingId: 'meeting_id',
  status: 'status',
  generatedFilePath: 'generated_file_path',
  signedFilePath: 'signed_file_path',
};

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, resolutionId } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('resolutions')
    .select('*')
    .eq('id', resolutionId)
    .eq('corporation_id', id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ resolution: rowToResolution(data as Record<string, unknown>) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, resolutionId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const col = PATCH_COLUMNS[k];
    if (col) update[col] = v;
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('resolutions')
    .update(update)
    .eq('id', resolutionId)
    .eq('corporation_id', id)
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'resolution_updated',
    fieldChanged: Object.keys(body as Record<string, unknown>).join(', '),
    newValue: (data.title as string | null) ?? undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, resolution: rowToResolution(data as Record<string, unknown>) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, resolutionId } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data: deleted, error } = await supabase
    .from('resolutions')
    .delete()
    .eq('id', resolutionId)
    .eq('corporation_id', id)
    .select('title');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'resolution_deleted',
    fieldChanged: (deleted?.[0]?.title as string | undefined) ?? undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
