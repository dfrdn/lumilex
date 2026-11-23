import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToResolution } from '@/lib/corporation-row';
import { logAudit, getClientIP } from '@/lib/audit';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('resolutions')
    .select('*')
    .eq('corporation_id', id)
    .order('date_of_resolution', { ascending: false });
  return NextResponse.json({
    resolutions: (data ?? []).map((r) => rowToResolution(r as Record<string, unknown>)),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const { kind, title, dateOfResolution, templateId, variables, freeFormBody, meetingId, bundledResolutionIds } =
    body as Record<string, unknown>;

  if (!kind || !title || !dateOfResolution) {
    return NextResponse.json({ error: 'kind, title, dateOfResolution are required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('resolutions')
    .insert({
      firm_id: session.firmId,
      corporation_id: id,
      meeting_id: (meetingId as string) ?? null,
      kind,
      title,
      date_of_resolution: dateOfResolution,
      template_id: (templateId as string) ?? null,
      variables: variables ?? {},
      free_form_body: (freeFormBody as string) ?? null,
      bundled_resolution_ids: Array.isArray(bundledResolutionIds) ? bundledResolutionIds : [],
      status: 'Draft',
      created_by: session.user.notionUserId,
    })
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'resolution_created',
    newValue: title as string,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, resolution: rowToResolution(data as Record<string, unknown>) });
}
