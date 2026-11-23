import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { canSwitchPortal } from '@/lib/portal/switch-access';
import { rowToCorporationFile } from '@/lib/corporation-row';
import { logAudit, getClientIP } from '@/lib/audit';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, fileId } = await params;
  const supabase = getServiceDbForFirm(session.firmId);

  const { data: row } = await supabase
    .from('corporation_files')
    .select('storage_path, name')
    .eq('id', Number(fileId))
    .eq('corporation_id', id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Best-effort: remove the storage object too.
  await supabase.storage.from('files').remove([row.storage_path as string]).catch(() => {});

  const { error } = await supabase
    .from('corporation_files')
    .delete()
    .eq('id', Number(fileId))
    .eq('corporation_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'file_deleted',
    fieldChanged: (row.name as string | null) ?? undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}

/** Share a company file with the client in the portal, or stop sharing it. A person's file never is. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, fileId } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.clientVisible !== 'boolean') return NextResponse.json({ error: 'clientVisible must be true or false' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data: row } = await supabase
    .from('corporation_files')
    .select('person_id')
    .eq('id', Number(fileId))
    .eq('corporation_id', id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (body.clientVisible && row.person_id != null) {
    return NextResponse.json({ error: "A person's ID or file stays with the firm." }, { status: 400 });
  }

  // What reaches the portal is decided by the same people who may switch the
  // company itself on: a lawyer on the team, the relationship partner, a
  // partner or an admin. Both directions, like the switch.
  const access = await canSwitchPortal(getServiceDbForFirm(session.firmId), 'corporation', id, {
    firmId: session.firmId,
    personId: session.user.notionUserId,
    role: session.user.role,
  });
  if (!access.ok) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status });
  if (!access.canSwitch) {
    return NextResponse.json(
      { error: 'Only a lawyer on the team, the relationship partner, a partner or an admin can change what the client sees.' },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('corporation_files')
    .update({ client_visible: body.clientVisible })
    .eq('id', Number(fileId))
    .eq('corporation_id', id)
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: body.clientVisible ? 'file_shared_with_client' : 'file_unshared_with_client',
    fieldChanged: (data.name as string | null) ?? undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, file: rowToCorporationFile(data as Record<string, unknown>) });
}
