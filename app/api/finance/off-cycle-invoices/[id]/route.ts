import { NextRequest, NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, offCycleActionSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { GENERATION_STALE_MS, runOffCycleGeneration } from '@/lib/billing/off-cycle';

export const maxDuration = 60;

/**
 * PATCH /api/finance/off-cycle-invoices/[id]  { action: 'cancel' | 'retry' }
 * Finance withdraws a request still awaiting the managing partner (or one
 * approved but whose draft failed to generate), or retries a failed generation.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const validation = await validateBody(req, offCycleActionSchema);
  if (!validation.success) return validation.response;
  const { action } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const now = new Date().toISOString();
  // A generation that failed, or was cut off and never recorded (generationStalled).
  const genFailed = `invoice_gen_status.eq.failed,and(invoice_gen_status.eq.pending,updated_at.lt."${new Date(Date.now() - GENERATION_STALE_MS).toISOString()}")`;
  // Each transition is conditional on the state it leaves, so two clicks (or a
  // decision landing mid-cancel) can't both win. An approved request whose
  // draft never generated can be withdrawn too: it still holds its fees, and
  // two requests holding the same fee would otherwise block each other.
  const { data, error } = action === 'cancel'
    ? await supabase
        .from('off_cycle_invoice_requests')
        .update({ status: 'cancelled', updated_at: now })
        .eq('id', id)
        .or(`status.eq.pending,and(status.eq.approved,or(${genFailed}))`)
        .select('id, client_name')
        .maybeSingle()
    : await supabase
        .from('off_cycle_invoice_requests')
        .update({ invoice_gen_status: 'pending', invoice_gen_error: null, updated_at: now })
        .eq('id', id)
        .eq('status', 'approved')
        .or(genFailed)
        .select('id, client_name')
        .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: action === 'cancel' ? 'Only a request awaiting approval, or one whose draft failed to generate, can be cancelled.' : 'Only a failed generation can be retried.' },
      { status: 409 },
    );
  }

  if (action === 'retry') {
    const email = session.user.email;
    after(() => runOffCycleGeneration(session.firmId, id, email));
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'OffCycleInvoiceRequest',
    entityId: String(id),
    entityName: data.client_name,
    action: action === 'cancel' ? 'cancelled' : 'generation_retried',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
