import { NextRequest, NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { validateBody, offCycleDecisionSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { createNotificationsBatch } from '@/lib/notifications';
import { runOffCycleGeneration } from '@/lib/billing/off-cycle';

// Generation (DOCX/PDF rendering + storage uploads) runs in an `after()` task,
// which counts toward the function's max duration.
export const maxDuration = 60;

/**
 * POST /api/finance/off-cycle-invoices/[id]/decision  { decision, notes }
 * The managing partner approves or rejects an off-cycle invoice request. This
 * is the only signature an off-cycle bill needs — it carries no time for a
 * relationship partner to review — so approval generates the draft at once.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isManagingPartner(session.user.notionUserId, session.firmId))) {
    return NextResponse.json({ error: 'Only the managing partner can approve or reject off-cycle invoices' }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const validation = await validateBody(req, offCycleDecisionSchema);
  if (!validation.success) return validation.response;
  const { decision, notes } = validation.data;
  const approve = decision === 'approve';

  // Partners may only read requests (RLS); the decision is written with the
  // service role, and only after the managing-partner identity check above.
  const authed = await getSupabaseServerAuthClient();
  const { data: visible, error: readErr } = await authed
    .from('off_cycle_invoice_requests')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  const { data, error } = await getServiceDbForFirm(session.firmId)
    .from('off_cycle_invoice_requests')
    .update({
      status: approve ? 'approved' : 'rejected',
      decided_by: session.user.notionUserId,
      decided_at: now,
      decision_notes: notes ?? '',
      invoice_gen_status: approve ? 'pending' : null,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id, client_name, period_label, requested_by')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'This request is no longer awaiting a decision.' }, { status: 409 });

  if (approve) {
    const email = session.user.email ?? 'mp-approval';
    after(() => runOffCycleGeneration(session.firmId, id, email));
  }

  after(() =>
    createNotificationsBatch([
      {
        person_id: data.requested_by,
        type: 'billing_clearance',
        title: approve
          ? `${data.client_name} — off-cycle invoice approved`
          : `${data.client_name} — off-cycle invoice rejected`,
        body: approve
          ? `${data.period_label}: the draft invoice is being generated and will appear in Invoices.`
          : notes,
        href: '/finance/invoices',
        entity_id: `off-cycle-request:${id}`,
      },
    ], session.firmId),
  );

  logAudit({
    firmId: session.firmId,
    entityType: 'OffCycleInvoiceRequest',
    entityId: String(id),
    entityName: data.client_name,
    action: approve ? 'approved' : 'rejected',
    newValue: notes || undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, status: approve ? 'approved' : 'rejected' });
}
