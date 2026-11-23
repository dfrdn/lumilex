import { NextRequest, NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody, offCycleRequestSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { createNotificationsBatch } from '@/lib/notifications';
import { isManagingPartner, managingPartnerIds } from '@/lib/auth/isManagingPartner';
import { manilaMonth } from '@/lib/dates';
import { defaultPeriodLabel, generationStalled, listOutstandingFees, resolveOffCycleLines } from '@/lib/billing/off-cycle';
import { pesoExact } from '@/lib/finance/format';
import { offCycleTotal } from '@/lib/billing/off-cycle-label';

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/**
 * GET /api/finance/off-cycle-invoices?status=pending,approved
 * Off-cycle invoice requests, newest first, with who filed and decided them and
 * the invoice each approval produced. Finance and partners (the managing
 * partner decides from the partner billing-review page).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user' && role !== 'partner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const statusParam = req.nextUrl.searchParams.get('status');
  const statuses = statusParam ? statusParam.split(',').filter((s) => (STATUSES as readonly string[]).includes(s)) : [];

  const supabase = await getSupabaseServerAuthClient();
  let query = supabase
    .from('off_cycle_invoice_requests')
    .select('id, client_name, billing_month, period_label, fee_lines, notes, status, requested_by, requested_at, decided_by, decided_at, decision_notes, invoice_gen_status, invoice_gen_error, invoice_id, updated_at')
    .order('requested_at', { ascending: false })
    .limit(100);
  if (statuses.length > 0) query = query.in('status', statuses);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];

  // Names and invoice numbers via service-role: partners can't read every
  // team row, and the invoice may be on a table their role only half-reads.
  const service = getServiceDbForFirm(session.firmId);
  const personIds = [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter((x): x is string => !!x))];
  const invoiceIds = rows.map((r) => r.invoice_id).filter((x): x is number => x != null);
  const [{ data: people }, { data: invoices }] = await Promise.all([
    personIds.length > 0
      ? service.from('team').select('person_id, name').in('person_id', personIds)
      : Promise.resolve({ data: [] as { person_id: string; name: string | null }[] }),
    invoiceIds.length > 0
      ? service.from('invoices').select('id, invoice_number, status').in('id', invoiceIds)
      : Promise.resolve({ data: [] as { id: number; invoice_number: string; status: string }[] }),
  ]);
  const nameById = new Map((people ?? []).map((p) => [p.person_id, p.name]));
  const invoiceById = new Map((invoices ?? []).map((i) => [i.id, i]));

  return NextResponse.json({
    canDecide: await isManagingPartner(session.user.notionUserId, session.firmId),
    requests: rows.map((r) => {
      const inv = r.invoice_id != null ? invoiceById.get(r.invoice_id) : undefined;
      const stalled = generationStalled(r);
      return {
        id: r.id,
        clientName: r.client_name,
        billingMonth: r.billing_month,
        periodLabel: r.period_label,
        feeLines: r.fee_lines,
        notes: r.notes,
        status: r.status,
        requestedBy: nameById.get(r.requested_by) ?? null,
        requestedAt: r.requested_at,
        decidedBy: r.decided_by ? nameById.get(r.decided_by) ?? null : null,
        decidedAt: r.decided_at,
        decisionNotes: r.decision_notes,
        invoiceGenStatus: stalled ? 'failed' : r.invoice_gen_status,
        invoiceGenError: stalled ? 'Generation stopped before it finished.' : r.invoice_gen_error,
        invoiceNumber: inv?.invoice_number ?? null,
        invoiceStatus: inv?.status ?? null,
      };
    }),
  });
}

/**
 * POST /api/finance/off-cycle-invoices
 * Finance files a request for a fee-only invoice. One-time fees are priced
 * from the matter's billing config; ad-hoc items carry their own amounts. The
 * managing partner is notified, and their approval generates the draft.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, offCycleRequestSchema);
  if (!validation.success) return validation.response;
  const { clientName, items, periodLabel, notes } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const outstanding = await listOutstandingFees(supabase, clientName);
  if (outstanding.matters.length === 0) {
    return NextResponse.json({ error: `${clientName} has no matters to bill.` }, { status: 404 });
  }
  const resolved = resolveOffCycleLines(items, outstanding);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 409 });

  const label = periodLabel || defaultPeriodLabel(resolved.feeLines);
  const { data: row, error } = await supabase
    .from('off_cycle_invoice_requests')
    .insert({
      firm_id: session.firmId,
      client_name: clientName,
      billing_month: manilaMonth(),
      period_label: label,
      fee_lines: resolved.feeLines,
      notes: notes ?? '',
      requested_by: session.user.notionUserId,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const total = offCycleTotal(resolved.feeLines);
  after(async () => {
    const mps = await managingPartnerIds(session.firmId);
    await createNotificationsBatch(mps.map((personId) => ({
      person_id: personId,
      type: 'billing_clearance' as const,
      title: `${clientName} — off-cycle invoice awaiting your approval`,
      body: `${label}: ${pesoExact(total)}. The draft is generated once you approve.`,
      href: '/dashboard/partner/billing-review',
      entity_id: `off-cycle-request:${row.id}`,
    })), session.firmId);
  });

  logAudit({
    firmId: session.firmId,
    entityType: 'OffCycleInvoiceRequest',
    entityId: String(row.id),
    entityName: clientName,
    action: 'created',
    newValue: `${label} (${pesoExact(total)})`,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ id: row.id }, { status: 201 });
}
