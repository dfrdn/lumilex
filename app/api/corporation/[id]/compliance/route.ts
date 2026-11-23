import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToCorporation } from '@/lib/corporation-row';
import { effectiveBillingMatterId } from '@/lib/corporation-row';
import { logAudit, getClientIP } from '@/lib/audit';
import { mintId } from '@/lib/ids';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';

const VALID_TYPES = new Set(['SEC GIS', 'SEC AFS', 'BIR Filing', 'Other Compliance']);

/**
 * POST /api/corporation/[id]/compliance
 *
 * Add a one-off compliance item for the corporation. Writes directly to the
 * deliverables table — these are native and do not round-trip through Notion.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const { name, type, externalDueDate, priority } = body as Record<string, unknown>;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const safeType = (typeof type === 'string' && VALID_TYPES.has(type)) ? type : 'Other Compliance';
  const safePriority = (priority === 'High' || priority === 'Medium' || priority === 'Low') ? priority : 'Medium';

  const supabase = await getSupabaseServerAuthClient();
  const { data: corpRow } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).maybeSingle();
  if (!corpRow) return NextResponse.json({ error: 'Corporation not found' }, { status: 404 });
  const corporation = rowToCorporation(corpRow as Record<string, unknown>);

  const matterId = effectiveBillingMatterId(corporation);
  if (!matterId) {
    return NextResponse.json({ error: 'No effective billing matter — set engagement scope first' }, { status: 400 });
  }
  const { data: matter } = await supabase.from('matters').select('name, client_name').eq('notion_id', matterId).maybeSingle();

  // Deliberately NOT `corp-deliv-${id}`: one-off items must stay invisible to
  // spawnComplianceDeliverables' idempotency guard, which matches on the full
  // corp id embedded in the auto-spawned rows' notion_id.
  const notionId = mintId('corp-deliv');
  const { data: deliverable, error } = await supabase.from('deliverables').insert({
    firm_id: session.firmId,
    notion_id: notionId,
    notion_url: '',
    name: name.trim(),
    type: safeType,
    status: DELIVERABLE_STATUS.NOT_STARTED,
    matter_id: matterId,
    subject_id: id,
    matter_name: (matter?.name as string) ?? '',
    client_name: (matter?.client_name as string) ?? '',
    priority: safePriority,
    external_due_date: (externalDueDate as string) || null,
    drafter_ids: [session.user.notionUserId],
    currently_with_ids: [session.user.notionUserId],
    created_time: new Date().toISOString(),
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'compliance_item_added',
    fieldChanged: safeType,
    newValue: name.trim(),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, notionId, deliverable });
}
