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
 * GET /api/finance/matter-billing/actions?matterId=X
 * Returns the action definitions for a matter (ordered).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('matter_billing_actions')
    .select('*')
    .eq('matter_id', matterId)
    .order('order_index', { ascending: true })
    .order('id', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ actions: data ?? [] });
}

/**
 * PUT /api/finance/matter-billing/actions
 * Body: { matterId, actions: [{ id?, name, rate, cap?, unit_label, order_index }] }
 * Diffs and syncs actions for the matter:
 *   - rows with an id are updated
 *   - rows without an id are inserted
 *   - any existing actions whose id isn't in the payload are deleted (cascade
 *     also removes their entries — finance is expected to clean up first if
 *     they want to preserve the history)
 */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  const auth = authorize(session);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json();
  const matterId = body.matterId as string | undefined;
  const actions = (body.actions ?? []) as Array<{
    id?: number;
    name: string;
    rate: number;
    cap: number | null;
    unit_label: string;
    order_index: number;
  }>;

  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('matter_billing_actions')
    .select('id')
    .eq('matter_id', matterId);

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const incomingIds = new Set(actions.filter((a) => a.id).map((a) => a.id!));
  const toDelete = (existing ?? []).filter((r) => !incomingIds.has(r.id)).map((r) => r.id);

  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from('matter_billing_actions')
      .delete()
      .in('id', toDelete);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  for (const a of actions) {
    const record = {
      matter_id: matterId,
      name: a.name,
      rate: a.rate,
      cap: a.cap,
      unit_label: a.unit_label ?? '',
      order_index: a.order_index,
    };
    if (a.id) {
      const { error: upErr } = await supabase
        .from('matter_billing_actions')
        .update(record)
        .eq('id', a.id);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    } else {
      const { error: insErr } = await supabase
        .from('matter_billing_actions')
        .insert({ firm_id: session!.firmId, ...record });
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
