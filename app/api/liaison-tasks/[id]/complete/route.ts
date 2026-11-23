import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * Mark an errand completed and record both transportation ledgers from the zone's
 * dual tariff:
 *  - INTERNAL (round_trip_rate, liaison-overridable): a `reimbursements` row that
 *    liquidates the liaison officer's allowance. Written with an empty client_name
 *    so it never reaches a client bill (billing fetches reimbursements by client).
 *  - EXTERNAL (external_rate, finance-controlled): a `matter_expenses` row billed
 *    to the client as a transportation expense — only when the errand is linked to
 *    a matter and the external rate is non-zero.
 *
 * Both financial writes use the service-role client: matter_expenses is RLS-gated
 * to finance/admin/super_user, and reimbursements INSERT requires the actor to be
 * in lawyer_ids (fails when a chief completes on behalf). Authorization is already
 * decided by the authed read above; the privileged writes follow.
 *
 * The reimbursement keys on a synthetic notion_id (`liaison-task-<id>`) and the
 * matter_expense keys on liaison_task_id, so retries upsert without dupes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  const me = session.user.notionUserId;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data: task } = await supabase
    .from('liaison_tasks')
    .select(
      'id, assigned_to, assigned_to_name, status, zone_id, matter_id, matter_name, title, scheduled_for, bill_at_internal, transportation_zones ( id, name, round_trip_rate, external_rate )',
    )
    .eq('id', id)
    .single();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const canCompleteOnBehalf =
    role === 'chief_liaison_officer' || role === 'admin' || role === 'super_user';
  if (task.assigned_to !== me && !canCompleteOnBehalf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (task.status === 'completed') {
    return NextResponse.json({ error: 'Already completed' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { amount, override_note, completion_note, bill_at_internal } = body as {
    amount?: number;
    override_note?: string;
    completion_note?: string;
    bill_at_internal?: boolean;
  };

  const zone = Array.isArray(task.transportation_zones)
    ? task.transportation_zones[0]
    : task.transportation_zones;
  // Internal tariff — actual cost reimbursed to the liaison (overridable).
  const tariffAmount = zone?.round_trip_rate != null ? Number(zone.round_trip_rate) : null;
  const finalAmount =
    amount != null && Number.isFinite(Number(amount)) ? Number(amount) : tariffAmount ?? 0;
  // "No markup" errands bill the client the internal amount instead of the zone's
  // external rate. The flag is set on the errand but can be overridden at completion.
  const billAtInternal =
    typeof bill_at_internal === 'boolean' ? bill_at_internal : !!task.bill_at_internal;
  const externalAmount = billAtInternal
    ? finalAmount
    : zone?.external_rate != null
      ? Number(zone.external_rate)
      : null;
  const overrideNote = (override_note ?? '').trim();
  const note = (completion_note ?? '').trim();

  // Both ledgers are dated to the day the errand was actually run (scheduled_for),
  // not the day it happens to be marked complete — that's the date finance and the
  // liaison expect to see on the client bill and the reimbursement. Fall back to the
  // completion date only when the errand carries no scheduled date.
  const completedAt = new Date().toISOString();
  const expenseDate =
    task.scheduled_for ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const synthNotionId = `liaison-task-${id}`;
  const expenseLabel = zone?.name
    ? `Transportation: ${zone.name} — ${task.title}`
    : `Transportation — ${task.title}`;

  // Financial writes happen BEFORE the status flip and are idempotent (keyed on
  // notion_id / liaison_task_id). If any of them fails we return 500 with the
  // errand still not completed, so the user can safely retry without the early
  // "Already completed" guard stranding a half-written entry. They use the
  // service-role client by design (see the file-level note).
  const service = getServiceDbForFirm(session.firmId);

  // 1) INTERNAL ledger — liaison liquidation. Empty client_name keeps it off the
  //    client bill (billing fetches reimbursements by client_name).
  const { error: rErr } = await service
    .from('reimbursements')
    .upsert(
      {
        notion_id: synthNotionId,
        notion_url: '',
        expense: expenseLabel,
        amount: finalAmount,
        expense_category: 'Transportation',
        expense_date: expenseDate,
        lawyer_ids: [task.assigned_to],
        lawyer_name: task.assigned_to_name ?? '',
        matter_id: task.matter_id ?? null,
        matter_name: task.matter_name ?? '',
        client_id: null,
        client_name: '',
        reimbursed: false,
        created_by_name: session.user.name ?? '',
        receipt_urls: [],
        liaison_task_id: id,
        tariff_amount: tariffAmount,
        tariff_override_note: overrideNote,
      },
      { onConflict: 'notion_id' },
    );
  if (rErr) {
    console.error('[liaison-tasks:complete:reimb]', rErr.message);
    return NextResponse.json(
      { error: 'Failed to record the liaison reimbursement' },
      { status: 500 },
    );
  }

  // 2) EXTERNAL ledger — client-billable transportation expense. Only when the
  //    errand is linked to a matter and the billable amount is non-zero.
  let billedExternal = false;
  if (task.matter_id && externalAmount != null && externalAmount > 0) {
    const { error: meErr } = await service
      .from('matter_expenses')
      .upsert(
        {
          matter_id: task.matter_id,
          description: expenseLabel,
          amount: externalAmount,
          category: 'Transportation',
          expense_date: expenseDate,
          receipt_urls: [],
          billed: false,
          created_by: session.user.name ?? '',
          liaison_task_id: id,
        },
        { onConflict: 'liaison_task_id' },
      );
    if (meErr) {
      console.error('[liaison-tasks:complete:matter-expense]', meErr.message);
      return NextResponse.json(
        { error: 'Failed to record the client billing entry' },
        { status: 500 },
      );
    }
    billedExternal = true;
  }

  // 3) Mark the errand completed LAST — once the money is recorded.
  const { error: updErr } = await supabase
    .from('liaison_tasks')
    .update({
      status: 'completed',
      completed_at: completedAt,
      completion_note: note,
      bill_at_internal: billAtInternal,
      updated_at: completedAt,
    })
    .eq('id', id);
  if (updErr) {
    console.error('[liaison-tasks:complete:update]', updErr.message);
    return NextResponse.json(
      { error: 'Expenses recorded but failed to mark the errand completed — retry.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    amount: finalAmount,
    tariff_amount: tariffAmount,
    external_amount: billedExternal ? externalAmount : null,
    overridden: overrideNote.length > 0 || (tariffAmount != null && finalAmount !== tariffAmount),
  });
}
