import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/**
 * GET /api/finance/matter-expenses?matterId=X&billed=false
 * Returns unified expenses: matter_expenses + reimbursements for a matter.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const matterId = params.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const billedFilter = params.get('billed');
  const supabase = await getSupabaseServerAuthClient();

  // Fetch finance-added expenses
  let expQuery = supabase
    .from('matter_expenses')
    .select('*')
    .eq('matter_id', matterId)
    .order('expense_date', { ascending: false });

  if (billedFilter !== null) {
    expQuery = expQuery.eq('billed', billedFilter === 'true');
  }

  // Fetch lawyer reimbursements for same matter. Exclude errand-driven ones
  // (liaison_task_id set): those are internal liaison liquidations, not
  // client-billable — the matching client charge is a separate matter_expense
  // row, so including them here would double-show and double-count the trip.
  let reimbQuery = supabase
    .from('reimbursements')
    .select('*')
    .eq('matter_id', matterId)
    .is('liaison_task_id', null)
    .order('expense_date', { ascending: false });

  const [expResult, reimbResult] = await Promise.all([expQuery, reimbQuery]);

  if (expResult.error) return NextResponse.json({ error: expResult.error.message }, { status: 500 });
  if (reimbResult.error) return NextResponse.json({ error: reimbResult.error.message }, { status: 500 });

  // Normalize reimbursements to match expense shape
  const normalizedReimb = (reimbResult.data ?? []).map((r: Record<string, unknown>) => ({
    id: `reimb-${r.id ?? r.notion_id}`,
    matter_id: r.matter_id,
    description: r.expense,
    amount: r.amount,
    category: r.expense_category ?? 'Other',
    expense_date: r.expense_date,
    receipt_urls: r.receipt_urls ?? [],
    billed: r.reimbursed ?? false,
    invoice_id: null,
    created_by: r.lawyer_name ?? r.created_by_name ?? '',
    created_at: r.synced_at ?? r.created_at,
    updated_at: r.synced_at ?? r.created_at,
    source: 'reimbursement' as const,
  }));

  const normalizedExp = (expResult.data ?? []).map((e: Record<string, unknown>) => ({
    id: e.id as number,
    matter_id: e.matter_id as string,
    description: e.description as string,
    amount: e.amount as number,
    category: e.category as string,
    expense_date: e.expense_date as string,
    receipt_urls: (e.receipt_urls ?? []) as { name?: string; url: string }[],
    billed: (e.billed ?? false) as boolean,
    invoice_id: e.invoice_id as number | null,
    created_by: (e.created_by ?? '') as string,
    created_at: e.created_at,
    updated_at: e.updated_at,
    source: 'finance' as const,
  }));

  // Merge and sort by date
  const all = [...normalizedExp, ...normalizedReimb].sort((a, b) =>
    String(b.expense_date).localeCompare(String(a.expense_date))
  );

  // Compute totals
  const totalBilled = all.filter((e) => e.billed).reduce((s, e) => s + Number(e.amount), 0);
  const totalUnbilled = all.filter((e) => !e.billed).reduce((s, e) => s + Number(e.amount), 0);

  return NextResponse.json({
    data: all,
    totalBilled,
    totalUnbilled,
    total: totalBilled + totalUnbilled,
  });
}

/**
 * POST /api/finance/matter-expenses
 * Add a new expense to a matter (finance/admin only).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  const allowed = ['admin', 'super_user', 'partner', 'finance'].includes(role);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { matterId, description, amount, category, expenseDate, receiptUrls } = body;

  if (!matterId || !description || !amount || !category || !expenseDate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('matter_expenses')
    .insert({
      firm_id: session.firmId,
      matter_id: matterId,
      description,
      amount,
      category,
      expense_date: expenseDate,
      receipt_urls: receiptUrls ?? [],
      created_by: session.user.name ?? session.user.email ?? 'unknown',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data }, { status: 201 });
}

/**
 * PATCH /api/finance/matter-expenses
 * Update an existing expense.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  const allowed = ['admin', 'super_user', 'partner', 'finance'].includes(role);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();

  const record: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.description !== undefined) record.description = updates.description;
  if (updates.amount !== undefined) record.amount = updates.amount;
  if (updates.category !== undefined) record.category = updates.category;
  if (updates.expenseDate !== undefined) record.expense_date = updates.expenseDate;
  if (updates.receiptUrls !== undefined) record.receipt_urls = updates.receiptUrls;

  const { data, error } = await supabase
    .from('matter_expenses')
    .update(record)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

/**
 * DELETE /api/finance/matter-expenses?id=X
 * Remove an expense.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  const allowed = ['admin', 'super_user', 'partner', 'finance'].includes(role);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('matter_expenses')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
