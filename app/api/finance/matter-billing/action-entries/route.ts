import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

const FINANCE_ROLES = ['admin', 'super_user', 'partner', 'finance'];

function authorize(session: { user?: { role?: string } } | null) {
  if (!session?.user) return { ok: false, status: 401, error: 'Unauthorized' };
  const role = session.user.role ?? 'lawyer';
  if (!FINANCE_ROLES.includes(role)) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true };
}

/**
 * GET /api/finance/matter-billing/action-entries?matterId=X
 * Returns logged action occurrences (most recent first).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('matter_action_entries')
    .select('*')
    .eq('matter_id', matterId)
    .order('entry_date', { ascending: false })
    .order('id', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entries: data ?? [] });
}

/**
 * POST /api/finance/matter-billing/action-entries
 * Body: { matterId, actionId, entryDate, quantity, description }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  const auth = authorize(session);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json();
  const { matterId, actionId, entryDate, quantity, description } = body;
  if (!matterId || !actionId || !entryDate) {
    return NextResponse.json({ error: 'matterId, actionId, entryDate required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('matter_action_entries')
    .insert({
      firm_id: session!.firmId,
      matter_id: matterId,
      action_id: actionId,
      entry_date: entryDate,
      quantity: quantity ?? 1,
      description: description ?? '',
      created_by: session?.user?.email ?? '',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

/**
 * DELETE /api/finance/matter-billing/action-entries?id=N
 * Only allowed if the entry has not yet been invoiced.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  const auth = authorize(session);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('matter_action_entries')
    .delete()
    .eq('id', id)
    .eq('invoiced', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
