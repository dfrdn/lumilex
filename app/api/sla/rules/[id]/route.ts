import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';

const ADMIN_ROLES = new Set(['admin', 'super_user']);

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  applies_to_matter_type: z.string().nullable().optional(),
  applies_to_deliverable_type: z.string().nullable().optional(),
  condition: z.object({
    status: z.string().optional(),
    idle_days_min: z.number().int().positive().optional(),
    due_date_lte_days: z.number().int().optional(),
  }).optional(),
  action: z.object({
    notify: z.object({
      roles: z.array(z.string()).optional(),
      persons: z.array(z.string()).optional(),
    }).optional(),
    reroute: z.object({
      append_role_to_currently_with: z.string(),
    }).optional(),
  }).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId || !ADMIN_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, PatchSchema);
  if (!validation.success) return validation.response;
  const { id } = await params;

  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('sla_rules')
    .update({ ...validation.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'SlaRule',
    entityId: id,
    action: 'updated',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ rule: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId || !ADMIN_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;
  const supabase = getServiceDbForFirm(session.firmId);
  const { error } = await supabase.from('sla_rules').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'SlaRule',
    entityId: id,
    action: 'deleted',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
