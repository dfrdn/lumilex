import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { ENUM_GROUPS, isFinanceEditable } from '@/lib/enum-options';

const ENUM_GROUP_KEYS = new Set(ENUM_GROUPS.map((g) => `${g.entity}:${g.field}`));

function canEditGroup(role: string | undefined, entity: string, field: string): boolean {
  if (role === 'admin' || role === 'super_user') return true;
  if (role === 'finance' && isFinanceEditable({ entity, field })) return true;
  return false;
}

const patchSchema = z.object({
  value: z.string().trim().min(1).max(100).optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

interface Ctx { params: Promise<{ id: string }> }

async function loadRow(firmId: string, id: number) {
  const supabase = getServiceDbForFirm(firmId);
  return supabase
    .from('enum_options')
    .select('id, entity, field, value, sort_order, is_active, metadata')
    .eq('id', id)
    .maybeSingle();
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const validation = await validateBody(req, patchSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  const { data: row } = await loadRow(session.firmId, id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!ENUM_GROUP_KEYS.has(`${row.entity}:${row.field}`)) {
    return NextResponse.json({ error: 'Unknown enum group' }, { status: 400 });
  }
  if (!canEditGroup(session.user.role, row.entity, row.field)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('enum_options')
    .update(body)
    .eq('id', id)
    .select('id, entity, field, value, sort_order, is_active, metadata')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'EnumOption',
    entityId: String(id),
    entityName: `${row.entity}.${row.field}`,
    action: 'updated',
    oldValue: row.value,
    newValue: data.value,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ option: data });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const { data: row } = await loadRow(session.firmId, id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canEditGroup(session.user.role, row.entity, row.field)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { error } = await supabase.from('enum_options').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'EnumOption',
    entityId: String(id),
    entityName: `${row.entity}.${row.field}`,
    action: 'deleted',
    oldValue: row.value,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
