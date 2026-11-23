import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, firmExpenseCreateSchema, firmExpenseUpdateSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { nextMonthStart } from '@/lib/finance/format';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ALLOWED = ['admin', 'super_user', 'finance'];

function gate(role: string | undefined) {
  return role ? ALLOWED.includes(role) : false;
}

/**
 * GET /api/finance/firm-expenses?from=YYYY-MM-DD&to=YYYY-MM-DD&month=YYYY-MM&category=Rent
 * The firm's own operating expenses (rent, payroll, utilities…). RLS gates by
 * the finance role; this is the firm's money-out side of cash flow.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!gate(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const month = params.get('month'); // YYYY-MM
  const category = params.get('category');

  const supabase = await getSupabaseServerAuthClient();
  let query = supabase
    .from('firm_expenses')
    .select('id, expense_date, category, amount, vendor, description, payment_method, notes, recurring_template_id, recorded_by, created_at')
    .order('expense_date', { ascending: false });

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    query = query.gte('expense_date', `${month}-01`).lt('expense_date', nextMonthStart(month));
  } else {
    if (from) {
      if (!ISO_DATE.test(from)) return NextResponse.json({ error: 'from must be YYYY-MM-DD' }, { status: 400 });
      query = query.gte('expense_date', from);
    }
    if (to) {
      if (!ISO_DATE.test(to)) return NextResponse.json({ error: 'to must be YYYY-MM-DD' }, { status: 400 });
      query = query.lte('expense_date', to);
    }
  }
  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const total = (data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  return NextResponse.json({ data: data ?? [], total });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!gate(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const validation = await validateBody(req, firmExpenseCreateSchema);
  if (!validation.success) return validation.response;
  const b = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('firm_expenses')
    .insert({
      firm_id: session.firmId,
      expense_date: b.expenseDate,
      category: b.category,
      amount: b.amount,
      vendor: b.vendor,
      description: b.description,
      payment_method: b.paymentMethod,
      notes: b.notes,
      recorded_by: session.user.notionUserId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'FirmExpense',
    entityId: String(data.id),
    action: 'created',
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    newValue: `${b.category} ₱${b.amount}`,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ data }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!gate(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const validation = await validateBody(req, firmExpenseUpdateSchema);
  if (!validation.success) return validation.response;
  const { id, ...u } = validation.data;

  const record: Record<string, unknown> = {};
  if (u.expenseDate !== undefined) record.expense_date = u.expenseDate;
  if (u.category !== undefined) record.category = u.category;
  if (u.amount !== undefined) record.amount = u.amount;
  if (u.vendor !== undefined) record.vendor = u.vendor;
  if (u.description !== undefined) record.description = u.description;
  if (u.paymentMethod !== undefined) record.payment_method = u.paymentMethod;
  if (u.notes !== undefined) record.notes = u.notes;

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('firm_expenses')
    .update(record)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'FirmExpense',
    entityId: String(id),
    action: 'updated',
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!gate(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase.from('firm_expenses').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'FirmExpense',
    entityId: id,
    action: 'deleted',
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
