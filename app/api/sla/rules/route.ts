import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';

const ADMIN_ROLES = new Set(['admin', 'super_user']);

const RuleSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  applies_to_matter_type: z.string().nullable().optional(),
  applies_to_deliverable_type: z.string().nullable().optional(),
  condition: z.object({
    status: z.string().optional(),
    idle_days_min: z.number().int().positive().optional(),
    due_date_lte_days: z.number().int().optional(),
  }).default({}),
  action: z.object({
    notify: z.object({
      roles: z.array(z.string()).optional(),
      persons: z.array(z.string()).optional(),
    }).optional(),
    reroute: z.object({
      append_role_to_currently_with: z.string(),
    }).optional(),
  }).default({}),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Authed client: sla_rules_admin_select RLS restricts reads to
  // partner/admin/super_user. A plain lawyer hitting this gets 0 rows rather
  // than the firm's escalation playbook.
  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('sla_rules')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId || !ADMIN_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, RuleSchema);
  if (!validation.success) return validation.response;
  const payload = validation.data;

  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('sla_rules')
    .insert({ ...payload, created_by: session.user.notionUserId })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'SlaRule',
    entityId: data.id,
    action: 'created',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ rule: data });
}
