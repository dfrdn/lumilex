import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const body = await req.json();
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: session.user.notionUserId,
    updated_by_name: session.user.name ?? '',
  };

  if ('name' in body) {
    const name = (body.name ?? '').toString().trim();
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    update.name = name;
  }
  if ('round_trip_rate' in body) {
    const rate = Number(body.round_trip_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1_000_000) {
      return NextResponse.json({ error: 'round_trip_rate must be 0–1,000,000' }, { status: 400 });
    }
    update.round_trip_rate = rate;
  }
  if ('external_rate' in body) {
    if (String(body.external_rate).trim() === '') {
      return NextResponse.json({ error: 'external_rate must be a number' }, { status: 400 });
    }
    const rate = Number(body.external_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1_000_000) {
      return NextResponse.json({ error: 'external_rate must be 0–1,000,000' }, { status: 400 });
    }
    update.external_rate = rate;
  }
  if ('notes' in body) update.notes = (body.notes ?? '').toString();
  if ('active' in body) update.active = !!body.active;

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase.from('transportation_zones').update(update).eq('id', id);
  if (error) {
    console.error('[zones:patch]', error.message);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  // Soft-delete: deactivate to preserve referential integrity with reimbursements/tasks.
  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('transportation_zones')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[zones:delete]', error.message);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
