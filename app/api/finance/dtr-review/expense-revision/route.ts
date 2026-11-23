import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { asString, asNumber, resetReviewToPending } from '@/lib/finance/review-coerce';

interface PostBody {
  billingMonth?: unknown;
  clientName?: unknown;
  expenseKey?: unknown;
  action?: unknown;
  // Snapshot fields (when action='set')
  amount?: unknown;
  description?: unknown;
  category?: unknown;
  expenseDate?: unknown;
}

async function authorize() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const role = session.user.role;
  const isMP = await isManagingPartner(session.user.notionUserId, session.firmId);
  if (role !== 'finance' && role !== 'super_user' && !isMP) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session, isMP };
}

/**
 * POST /api/finance/dtr-review/expense-revision
 * Records a bundle-scoped expense edit ('set') or exclusion ('exclude').
 * Append-only; latest by edited_at wins.
 */
export async function POST(req: NextRequest) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { session, isMP } = auth;

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const billingMonth = asString(body.billingMonth);
  const clientName = asString(body.clientName);
  const expenseKey = asString(body.expenseKey);
  const action = asString(body.action);

  if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billingMonth must be YYYY-MM' }, { status: 400 });
  }
  if (!clientName) return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  if (!expenseKey) return NextResponse.json({ error: 'expenseKey is required' }, { status: 400 });
  if (action !== 'set' && action !== 'exclude' && action !== 'waive') {
    return NextResponse.json({ error: "action must be 'set', 'exclude', or 'waive'" }, { status: 400 });
  }

  const expenseDate = asString(body.expenseDate);
  if (expenseDate && !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    return NextResponse.json({ error: 'expenseDate must be YYYY-MM-DD' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const row: Record<string, unknown> = {
    firm_id: session.firmId,
    billing_month: billingMonth,
    client_name: clientName,
    expense_key: expenseKey,
    action,
    edited_by: session.user.notionUserId,
  };
  // 'waive' snapshots the values (like 'set') so the shown-but-struck amount persists.
  if (action === 'set' || action === 'waive') {
    row.amount = asNumber(body.amount);
    row.description = asString(body.description);
    row.category = asString(body.category);
    row.expense_date = expenseDate;
  }

  const { data, error } = await supabase
    .from('expense_revisions')
    .insert(row)
    .select('id, edited_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await resetReviewToPending(supabase, isMP, billingMonth, clientName);

  return NextResponse.json({ id: data.id, editedAt: data.edited_at });
}

/**
 * DELETE /api/finance/dtr-review/expense-revision?billingMonth&clientName&expenseKey
 * Clears all revisions for one expense in a bundle — reverts it to the raw
 * reimbursement / matter_expense (restores an excluded expense, or undoes edits).
 */
export async function DELETE(req: NextRequest) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { isMP } = auth;

  const billingMonth = asString(req.nextUrl.searchParams.get('billingMonth'));
  const clientName = asString(req.nextUrl.searchParams.get('clientName'));
  const expenseKey = asString(req.nextUrl.searchParams.get('expenseKey'));

  if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billingMonth must be YYYY-MM' }, { status: 400 });
  }
  if (!clientName) return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  if (!expenseKey) return NextResponse.json({ error: 'expenseKey is required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('expense_revisions')
    .delete()
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .eq('expense_key', expenseKey);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await resetReviewToPending(supabase, isMP, billingMonth, clientName);

  return NextResponse.json({ ok: true });
}
