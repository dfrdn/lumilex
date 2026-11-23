import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, firmExpenseTemplateCreateSchema, firmExpenseTemplateUpdateSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';

const ALLOWED = ['admin', 'super_user', 'finance'];

function gate(role: string | undefined) {
  return role ? ALLOWED.includes(role) : false;
}

/**
 * Recurring firm-expense definitions (rent, payroll, subscriptions). A cron
 * (/api/cron/firm-expense-recurring) materializes due templates into firm_expenses
 * rows once per period. RLS gates by the finance role.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!gate(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('firm_expense_templates')
    .select('id, category, amount, vendor, description, payment_method, cadence, day_of_month, start_date, end_date, active, last_generated_month, created_at')
    .order('active', { ascending: false })
    .order('category', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!gate(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const validation = await validateBody(req, firmExpenseTemplateCreateSchema);
  if (!validation.success) return validation.response;
  const b = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('firm_expense_templates')
    .insert({
      firm_id: session.firmId,
      category: b.category,
      amount: b.amount,
      vendor: b.vendor,
      description: b.description,
      payment_method: b.paymentMethod,
      cadence: b.cadence,
      day_of_month: b.dayOfMonth,
      start_date: b.startDate,
      end_date: b.endDate ?? null,
      active: b.active,
      recorded_by: session.user.notionUserId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'FirmExpenseTemplate',
    entityId: String(data.id),
    action: 'created',
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    newValue: `${b.category} ₱${b.amount} ${b.cadence}`,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ data }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!gate(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const validation = await validateBody(req, firmExpenseTemplateUpdateSchema);
  if (!validation.success) return validation.response;
  const { id, ...u } = validation.data;

  const record: Record<string, unknown> = {};
  if (u.category !== undefined) record.category = u.category;
  if (u.amount !== undefined) record.amount = u.amount;
  if (u.vendor !== undefined) record.vendor = u.vendor;
  if (u.description !== undefined) record.description = u.description;
  if (u.paymentMethod !== undefined) record.payment_method = u.paymentMethod;
  if (u.cadence !== undefined) record.cadence = u.cadence;
  if (u.dayOfMonth !== undefined) record.day_of_month = u.dayOfMonth;
  if (u.startDate !== undefined) record.start_date = u.startDate;
  if (u.endDate !== undefined) record.end_date = u.endDate;
  if (u.active !== undefined) record.active = u.active;

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('firm_expense_templates')
    .update(record)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'FirmExpenseTemplate',
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
  const { error } = await supabase.from('firm_expense_templates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'FirmExpenseTemplate',
    entityId: id,
    action: 'deleted',
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
