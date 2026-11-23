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

const createSchema = z.object({
  entity: z.string().min(1),
  field: z.string().min(1),
  value: z.string().trim().min(1).max(100),
  sort_order: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const entity = url.searchParams.get('entity');
  const field = url.searchParams.get('field');
  const includeInactive = url.searchParams.get('all') === '1';

  const supabase = getServiceDbForFirm(session.firmId);
  let query = supabase
    .from('enum_options')
    .select('id, entity, field, value, sort_order, is_active, metadata')
    .order('entity', { ascending: true })
    .order('field', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (entity) query = query.eq('entity', entity);
  if (field) query = query.eq('field', field);
  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ options: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, createSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  if (!ENUM_GROUP_KEYS.has(`${body.entity}:${body.field}`)) {
    return NextResponse.json({ error: 'Unknown enum group' }, { status: 400 });
  }
  if (!canEditGroup(session.user.role, body.entity, body.field)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  let sortOrder = body.sort_order;
  if (sortOrder == null) {
    const { data: maxRow } = await supabase
      .from('enum_options')
      .select('sort_order')
      .eq('entity', body.entity)
      .eq('field', body.field)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = ((maxRow?.sort_order as number | undefined) ?? 0) + 10;
  }

  const { data, error } = await supabase
    .from('enum_options')
    .insert({
      entity: body.entity,
      field: body.field,
      value: body.value,
      sort_order: sortOrder,
      metadata: body.metadata ?? null,
      is_active: true,
    })
    .select('id, entity, field, value, sort_order, is_active, metadata')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'EnumOption',
    entityId: String(data.id),
    entityName: `${body.entity}.${body.field}`,
    action: 'created',
    newValue: body.value,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ option: data });
}
