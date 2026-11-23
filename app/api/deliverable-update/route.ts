import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';
import { resolvePersonIds } from '@/lib/queries/people';
import { DELIVERABLE_STATUS, filedOnDay } from '@/lib/deliverable-status';

// Fields editable by partners/super_users
const PARTNER_FIELDS = [
  'status', 'currently_with_ids', 'drafter_ids',
  'reviewer_ids', 'review_dates',
  'external_due_date', 'date_done', 'subtype',
];

// Fields editable by associates (lawyers)
const ASSOCIATE_FIELDS = ['status', 'currently_with_ids', 'date_done'];

// Fields that store person IDs (arrays or single)
const PEOPLE_FIELDS = ['currently_with_ids', 'drafter_ids', 'reviewer_ids'];

/** Resolve person ID(s) to a display string of initials, e.g. "ADC, FGH" */
async function formatPeopleValue(firmId: string, value: unknown): Promise<string> {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  if (ids.length === 0) return '(none)';
  const map = await resolvePersonIds(firmId, ids);
  return ids.map((id) => map.get(id)?.initials ?? id.slice(0, 6)).join(', ');
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  currently_with_ids: 'Currently With',
  drafter_ids: 'Drafters',
  reviewer_ids: 'Reviewers',
  review_dates: 'Review Dates',
  external_due_date: 'Deadline',
  date_done: 'Filed or Sent On',
  subtype: 'Subtype',
};

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';

  const { deliverableId, field, value } = await req.json();

  if (!deliverableId || !field) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Role-based permission check
  const isPartner = role === 'partner' || role === 'super_user';
  const allowedFields = isPartner ? PARTNER_FIELDS : ASSOCIATE_FIELDS;
  // Admins classify documents (subtype) without otherwise editing the workflow.
  const adminMayEdit = role === 'admin' && field === 'subtype';

  if (!allowedFields.includes(field) && !adminMayEdit) {
    return NextResponse.json({ error: 'Insufficient permissions for this field' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();

  try {
    // Fetch current value for audit log
    const { data: current } = await supabase
      .from('deliverables')
      .select(field)
      .eq('notion_id', deliverableId)
      .single();

    const oldValue = current?.[field];

    const update: Record<string, unknown> = { [field]: value };
    // The day it went out: today or earlier, and only once it has gone.
    if (field === 'date_done') {
      if (!value || !filedOnDay(value)) {
        return NextResponse.json({ error: 'Pick today or an earlier date' }, { status: 400 });
      }
      const { data: row } = await supabase
        .from('deliverables')
        .select('status')
        .eq('notion_id', deliverableId)
        .single();
      if (row?.status !== DELIVERABLE_STATUS.FILED_OR_SENT_OUT) {
        return NextResponse.json({ error: 'Only a filed or sent-out deliverable has a filing date' }, { status: 400 });
      }
    }
    // Moving to "Filed or Sent out" stamps today in Manila; the detail page can
    // correct the day after. (Analysis on status→finalized is the DB trigger
    // `on_deliverable_status_finalized`'s job — no app-side fire needed.)
    if (field === 'status' && value === DELIVERABLE_STATUS.FILED_OR_SENT_OUT && oldValue !== value) {
      update.date_done = filedOnDay(undefined);
    }

    const { error } = await supabase
      .from('deliverables')
      .update(update)
      .eq('notion_id', deliverableId);

    if (error) throw error;

    // Log audit entry
    logAudit({
      firmId: session.firmId,
      entityType: 'deliverable',
      entityId: deliverableId,
      action: 'field_update',
      fieldChanged: field,
      oldValue: JSON.stringify(oldValue),
      newValue: JSON.stringify(value),
      performedBy: personId,
      ipAddress: getClientIP(req),
    });

    // Log as deliverable action for version history
    const label = FIELD_LABELS[field] ?? field;
    let displayOld: string;
    let displayNew: string;
    if (PEOPLE_FIELDS.includes(field)) {
      [displayOld, displayNew] = await Promise.all([
        formatPeopleValue(session.firmId, oldValue),
        formatPeopleValue(session.firmId, value),
      ]);
    } else {
      displayOld = typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue ?? '');
      displayNew = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    }
    await supabase.from('deliverable_actions').insert({
      firm_id: session.firmId,
      deliverable_id: deliverableId,
      action: `Updated ${label}`,
      old_status: displayOld,
      new_status: displayNew,
      performed_by: personId,
    });

    if (update.date_done) return NextResponse.json({ success: true, dateDone: update.date_done });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[deliverable-update]', err);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
