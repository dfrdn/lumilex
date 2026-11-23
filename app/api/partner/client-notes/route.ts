import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import {
  validateBody,
  clientNoteCreateSchema,
  clientNoteUpdateSchema,
  clientNoteDeleteSchema,
} from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';

const ALLOWED_ROLES = ['partner', 'super_user'];

function guard(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function POST(req: Request) {
  const session = await getSession();
  const denied = guard(session);
  if (denied) return denied;

  const validation = await validateBody(req, clientNoteCreateSchema);
  if (!validation.success) return validation.response;
  const { clientId, body } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('client_partner_notes')
    .insert({ firm_id: session!.firmId, client_id: clientId, author_id: session!.user.notionUserId, body })
    .select('id, body, author_id, created_at, updated_at')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
  }

  logAudit({
    firmId: session!.firmId,
    entityType: 'ClientNote',
    entityId: String(data.id),
    action: 'created',
    performedBy: session!.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    note: {
      id: data.id,
      body: data.body,
      authorId: data.author_id,
      authorName: session!.user.name ?? 'You',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  const denied = guard(session);
  if (denied) return denied;

  const validation = await validateBody(req, clientNoteUpdateSchema);
  if (!validation.success) return validation.response;
  const { id, body } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('client_partner_notes')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session!.firmId,
    entityType: 'ClientNote',
    entityId: String(id),
    action: 'updated',
    performedBy: session!.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  const denied = guard(session);
  if (denied) return denied;

  const validation = await validateBody(req, clientNoteDeleteSchema);
  if (!validation.success) return validation.response;
  const { id } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase.from('client_partner_notes').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session!.firmId,
    entityType: 'ClientNote',
    entityId: String(id),
    action: 'deleted',
    performedBy: session!.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true });
}
