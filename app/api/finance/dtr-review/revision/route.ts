import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { asString, asInt, asBool, asStringArray, resetReviewToPending } from '@/lib/finance/review-coerce';

interface PostBody {
  billingMonth?: unknown;
  clientName?: unknown;
  originalDtrId?: unknown;
  createdEntryKey?: unknown;
  action?: unknown;
  // Snapshot fields (when action='set')
  hours?: unknown;
  minutes?: unknown;
  date?: unknown;
  lawyerName?: unknown;
  withIds?: unknown;
  withNames?: unknown;
  task?: unknown;
  remarks?: unknown;
  matterId?: unknown;
  billed?: unknown;
  nonBillable?: unknown;
  // For action='waive': attendee names whose fanned line is waived (per-attendee).
  waivedWith?: unknown;
}

/**
 * POST /api/finance/dtr-review/revision
 * Inserts a new revision row. Multiple revisions per logical entity are kept;
 * "latest by edited_at" wins. If the bundle is currently approved, this resets
 * its review status to pending so the managing partner re-reviews.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role;
  // Finance and super_user can always edit. Managing partner can also edit
  // directly to avoid the back-and-forth (finance → MP → finance to fix one
  // hours value). Other partners are still locked out.
  const isMP = await isManagingPartner(session.user.notionUserId, session.firmId);
  if (role !== 'finance' && role !== 'super_user' && !isMP) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;

  const billingMonth = asString(body.billingMonth);
  const clientName = asString(body.clientName);
  const originalDtrId = asString(body.originalDtrId);
  const createdEntryKey = asString(body.createdEntryKey);
  const action = asString(body.action);

  if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billingMonth must be YYYY-MM' }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  }
  if (action !== 'set' && action !== 'exclude' && action !== 'waive') {
    return NextResponse.json({ error: "action must be 'set', 'exclude', or 'waive'" }, { status: 400 });
  }
  // Exactly one of originalDtrId / createdEntryKey
  if ((originalDtrId && createdEntryKey) || (!originalDtrId && !createdEntryKey)) {
    return NextResponse.json(
      { error: 'Provide exactly one of originalDtrId or createdEntryKey' },
      { status: 400 },
    );
  }

  const supabase = await getSupabaseServerAuthClient();

  // Build the row. For 'exclude', leave snapshot fields null. 'waive' carries the
  // snapshot (like 'set') so the shown-but-struck values persist on the invoice.
  const row: Record<string, unknown> = {
    firm_id: session.firmId,
    billing_month: billingMonth,
    client_name: clientName,
    original_dtr_id: originalDtrId,
    created_entry_key: createdEntryKey,
    action,
    edited_by: session.user.notionUserId,
  };

  if (action === 'set' || action === 'waive') {
    row.hours = asInt(body.hours);
    row.minutes = asInt(body.minutes);
    row.date = asString(body.date);
    row.lawyer_name = asString(body.lawyerName);
    row.with_ids = asStringArray(body.withIds);
    row.with_names = asStringArray(body.withNames);
    row.task = asString(body.task);
    row.remarks = asString(body.remarks);
    row.matter_id = asString(body.matterId);
    row.billed = asBool(body.billed);
    row.non_billable = asBool(body.nonBillable);
  }
  if (action === 'waive') {
    // Which attendees are waived. Empty/absent → whole entry (all attendees).
    const w = asStringArray(body.waivedWith) ?? [];
    row.waived_with = w.length > 0 ? w : null;
  }

  const { data, error } = await supabase
    .from('dtr_revisions')
    .insert(row)
    .select('id, edited_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If the bundle was already approved or rejected, reset to pending so the
  // managing partner re-reviews (skipped when the editor IS the managing partner).
  await resetReviewToPending(supabase, isMP, billingMonth, clientName);

  return NextResponse.json({ id: data.id, editedAt: data.edited_at });
}
