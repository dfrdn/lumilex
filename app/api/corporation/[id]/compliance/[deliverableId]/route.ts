import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';
import { isDelivered, isClosed } from '@/lib/deliverable-status';
import { manilaToday } from '@/lib/dates';

const PATCH_COLUMNS: Record<string, string> = {
  status: 'status',
  priority: 'priority',
  externalDueDate: 'external_due_date',
  name: 'name',
  dateDone: 'date_done',
};

/**
 * PATCH /api/corporation/[id]/compliance/[deliverableId]
 *
 * Quick-edit a corporation's compliance deliverable: status / priority / due
 * date / name. Writes directly to deliverables (does not round-trip Notion).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; deliverableId: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, deliverableId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const col = PATCH_COLUMNS[k];
    if (col) update[col] = v;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No allowed fields in body' }, { status: 400 });
  }
  // Marking a compliance item filed stamps date_done — the day it went in,
  // when the caller says (a filing recorded after the fact), else today;
  // moving it back to an open status clears it.
  if (typeof update.status === 'string' && isDelivered(update.status)) {
    const filedOn = typeof update.date_done === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(update.date_done) ? update.date_done : null;
    if (filedOn && filedOn > manilaToday()) {
      return NextResponse.json({ error: 'That date is in the future' }, { status: 400 });
    }
    update.date_done = filedOn ?? new Date().toISOString();
  } else if (typeof update.status === 'string' && !isClosed(update.status)) {
    update.date_done = null;
  }

  const supabase = await getSupabaseServerAuthClient();

  // Scope the update to this company's own filings — those that name it, or
  // legacy ones that name no company and sit on one of its matters. A sibling
  // on a shared retainer must not be able to close this company's filing, and
  // the deliverableId alone must not be enough.
  const { data: corp } = await supabase.from('corporations').select('id').eq('id', id).maybeSingle();
  if (!corp) return NextResponse.json({ error: 'Corporation not found' }, { status: 404 });
  const { data: links } = await supabase.from('matter_subjects').select('matter_id').eq('subject_id', id);
  const matterIds = (links ?? []).map((l) => l.matter_id as string);
  const owned = matterIds.length
    ? `subject_id.eq.${id},and(subject_id.is.null,matter_id.in.(${matterIds.map((m) => `"${m}"`).join(',')}))`
    : `subject_id.eq.${id}`;

  const { data: deliverable, error } = await supabase
    .from('deliverables')
    .update(update)
    .eq('notion_id', deliverableId)
    .or(owned)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deliverable) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });

  if (typeof update.status === 'string') {
    logAudit({
      firmId: session.firmId,
      entityType: 'Corporation',
      entityId: id,
      action: 'compliance_status_changed',
      fieldChanged: (deliverable.name as string) ?? deliverableId,
      newValue: update.status,
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });
  }

  return NextResponse.json({ ok: true, deliverable });
}
