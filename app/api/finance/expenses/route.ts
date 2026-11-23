import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/**
 * GET /api/finance/expenses
 * Firm-wide expenses: merges matter_expenses + reimbursements.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const clientName = req.nextUrl.searchParams.get('clientName');
  const category = req.nextUrl.searchParams.get('category');
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const billedParam = req.nextUrl.searchParams.get('billed');

  // Build matter_expenses query
  let mexpQuery = supabase
    .from('matter_expenses')
    .select('id, matter_id, description, amount, category, expense_date, billed, created_at')
    .order('expense_date', { ascending: false })
    .limit(500);

  if (from) mexpQuery = mexpQuery.gte('expense_date', from);
  if (to) mexpQuery = mexpQuery.lte('expense_date', to);
  if (category) mexpQuery = mexpQuery.eq('category', category);
  if (billedParam === 'true') mexpQuery = mexpQuery.eq('billed', true);
  if (billedParam === 'false') mexpQuery = mexpQuery.eq('billed', false);

  // Build reimbursements query
  let reimbQuery = supabase
    .from('reimbursements')
    .select('notion_id, client_name, matter_name, expense, expense_category, amount, expense_date, reimbursed, created_at')
    .order('expense_date', { ascending: false })
    .limit(500);

  if (from) reimbQuery = reimbQuery.gte('expense_date', from);
  if (to) reimbQuery = reimbQuery.lte('expense_date', to);
  if (category) reimbQuery = reimbQuery.eq('expense_category', category);
  if (billedParam === 'true') reimbQuery = reimbQuery.eq('reimbursed', true);
  if (billedParam === 'false') reimbQuery = reimbQuery.eq('reimbursed', false);
  if (clientName) reimbQuery = reimbQuery.eq('client_name', clientName);

  // If clientName filter, also filter matter_expenses via matters table
  let matterIds: string[] | null = null;
  if (clientName) {
    const { data: matters } = await supabase
      .from('matters')
      .select('notion_id')
      .eq('client_name', clientName);
    matterIds = (matters ?? []).map((m: { notion_id: string }) => m.notion_id);
    if (matterIds.length > 0) {
      mexpQuery = mexpQuery.in('matter_id', matterIds);
    } else {
      // No matters for this client, skip matter_expenses query
      mexpQuery = mexpQuery.eq('matter_id', '__none__');
    }
  }

  const [{ data: matterExpenses }, { data: reimbursements }] = await Promise.all([
    mexpQuery,
    reimbQuery,
  ]);

  // Look up matter names for matter_expenses
  const allMatterIds = [...new Set((matterExpenses ?? []).map((e: { matter_id: string }) => e.matter_id))];
  let matterNameMap: Record<string, { name: string; client_name: string }> = {};
  if (allMatterIds.length > 0) {
    const { data: matters } = await supabase
      .from('matters')
      .select('notion_id, name, client_name')
      .in('notion_id', allMatterIds);
    (matters ?? []).forEach((m: { notion_id: string; name: string; client_name: string }) => {
      matterNameMap[m.notion_id] = { name: m.name, client_name: m.client_name };
    });
  }

  // Normalize to unified shape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const financeExpenses = (matterExpenses ?? []).map((e: any) => ({
    id: `mexp-${e.id}`,
    date: e.expense_date,
    description: e.description,
    category: e.category,
    amount: Number(e.amount),
    clientName: matterNameMap[e.matter_id]?.client_name ?? '',
    matterName: matterNameMap[e.matter_id]?.name ?? '',
    billed: e.billed,
    source: 'finance' as const,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reimbExpenses = (reimbursements ?? []).map((e: any) => ({
    id: e.notion_id,
    date: e.expense_date,
    description: e.expense,
    category: e.expense_category,
    amount: Number(e.amount),
    clientName: e.client_name,
    matterName: e.matter_name ?? '',
    billed: e.reimbursed,
    source: 'reimbursement' as const,
  }));

  const all = [...financeExpenses, ...reimbExpenses].sort(
    (a, b) => (b.date ?? '').localeCompare(a.date ?? ''),
  );

  // Summary
  const totalAmount = all.reduce((s, e) => s + e.amount, 0);
  const billedAmount = all.filter((e) => e.billed).reduce((s, e) => s + e.amount, 0);
  const unbilledAmount = all.filter((e) => !e.billed).reduce((s, e) => s + e.amount, 0);

  // Category breakdown
  const byCategory: Record<string, number> = {};
  all.forEach((e) => {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
  });

  return NextResponse.json({
    expenses: all,
    total: all.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    billedAmount: Math.round(billedAmount * 100) / 100,
    unbilledAmount: Math.round(unbilledAmount * 100) / 100,
    byCategory,
  });
}
