import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

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
  // RLS allows finance/admin to read all reimbursements (role override).

  const status = req.nextUrl.searchParams.get('status'); // 'all' | 'pending' | 'reimbursed'
  const client = req.nextUrl.searchParams.get('client');

  let query = supabase
    .from('reimbursements')
    .select('notion_id, expense, amount, expense_category, expense_date, matter_name, client_name, lawyer_name, reimbursed, billed, receipt_urls, created_time')
    .order('expense_date', { ascending: false });

  if (status === 'pending') {
    query = query.eq('reimbursed', false);
  } else if (status === 'reimbursed') {
    query = query.eq('reimbursed', true);
  }

  if (client) {
    query = query.eq('client_name', client);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[finance-reimbursements]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ reimbursements: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { notionIds, reimbursed } = await req.json() as {
    notionIds: string[];
    reimbursed: boolean;
  };

  if (!Array.isArray(notionIds) || notionIds.length === 0 || typeof reimbursed !== 'boolean') {
    return NextResponse.json({ error: 'notionIds (array) and reimbursed (boolean) are required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // RLS allows finance/admin to update reimbursed flag (role override).

  const { error } = await supabase
    .from('reimbursements')
    .update({ reimbursed })
    .in('notion_id', notionIds);

  if (error) {
    console.error('[finance-reimbursements]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: notionIds.length });
}
