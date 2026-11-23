import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const includeInactive = req.nextUrl.searchParams.get('all') === '1';
  const supabase = await getSupabaseServerAuthClient();
  let q = supabase.from('transportation_zones').select('*').order('name');
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) {
    console.error('[zones:list]', error.message);
    return NextResponse.json({ error: 'Failed to load zones' }, { status: 500 });
  }
  return NextResponse.json({ zones: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const name: string = (body.name ?? '').toString().trim();
  const rate = Number(body.round_trip_rate);
  // External rate defaults to the internal rate when not supplied or left blank
  // (empty string would otherwise coerce to 0 via Number('')).
  const externalProvided =
    body.external_rate != null && String(body.external_rate).trim() !== '';
  const externalRate = externalProvided ? Number(body.external_rate) : rate;
  const notes: string = (body.notes ?? '').toString();

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!Number.isFinite(rate) || rate < 0 || rate > 1_000_000) {
    return NextResponse.json({ error: 'round_trip_rate must be 0–1,000,000' }, { status: 400 });
  }
  if (!Number.isFinite(externalRate) || externalRate < 0 || externalRate > 1_000_000) {
    return NextResponse.json({ error: 'external_rate must be 0–1,000,000' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // RLS gates INSERT to finance/admin/super_user.
  const { data, error } = await supabase
    .from('transportation_zones')
    .insert({
      firm_id: session.firmId,
      name,
      round_trip_rate: rate,
      external_rate: externalRate,
      notes,
      updated_by: session.user.notionUserId,
      updated_by_name: session.user.name ?? '',
    })
    .select('*')
    .single();
  if (error) {
    console.error('[zones:create]', error.message);
    return NextResponse.json({ error: 'Failed to create zone' }, { status: 500 });
  }
  return NextResponse.json({ zone: data });
}
