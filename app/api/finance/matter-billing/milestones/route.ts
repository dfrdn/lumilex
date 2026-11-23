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
 * GET /api/finance/matter-billing/milestones?matterId=X
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('matter_billing_milestones')
    .select('*')
    .eq('matter_id', matterId)
    .order('order_index', { ascending: true })
    .order('id', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ milestones: data ?? [] });
}

/**
 * PUT /api/finance/matter-billing/milestones
 * Body: { matterId, milestones: [{ id?, name, description, fee, target_date, order_index }] }
 * Mirrors the actions sync logic. Already-invoiced milestones are left alone:
 * if a payload omits them, they survive (to preserve the audit trail) but
 * their definition is not updated.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  const auth = authorize(session);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json();
  const matterId = body.matterId as string | undefined;
  const incoming = (body.milestones ?? []) as Array<{
    id?: number;
    name: string;
    description: string;
    fee: number;
    target_date: string | null;
    order_index: number;
  }>;
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('matter_billing_milestones')
    .select('id, invoiced')
    .eq('matter_id', matterId);
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const incomingIds = new Set(incoming.filter((m) => m.id).map((m) => m.id!));
  const toDelete = (existing ?? [])
    .filter((r) => !incomingIds.has(r.id) && !r.invoiced)
    .map((r) => r.id);

  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from('matter_billing_milestones')
      .delete()
      .in('id', toDelete);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  for (const m of incoming) {
    const record = {
      matter_id: matterId,
      name: m.name,
      description: m.description ?? '',
      fee: m.fee,
      target_date: m.target_date,
      order_index: m.order_index,
    };
    if (m.id) {
      const { error: upErr } = await supabase
        .from('matter_billing_milestones')
        .update(record)
        .eq('id', m.id)
        .eq('invoiced', false);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    } else {
      const { error: insErr } = await supabase
        .from('matter_billing_milestones')
        .insert({ firm_id: session!.firmId, ...record });
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/finance/matter-billing/milestones
 * Body: { id, reached: boolean }
 * Sets/clears reached_at; reached_by is captured from session.
 * Already-invoiced milestones cannot be un-reached.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  const auth = authorize(session);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id, reached } = await req.json();
  if (!id || typeof reached !== 'boolean') {
    return NextResponse.json({ error: 'id and reached required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const update = reached
    ? { reached_at: new Date().toISOString(), reached_by: session?.user?.email ?? '' }
    : { reached_at: null, reached_by: null };

  const { error } = await supabase
    .from('matter_billing_milestones')
    .update(update)
    .eq('id', id)
    .eq('invoiced', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
