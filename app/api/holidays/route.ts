import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getStaticHolidaysInRange } from '@/lib/legal/ph-holidays';

async function assertAuth() {
  const session = await getSession();
  if (!session?.user) return null;
  return session;
}

// GET /api/holidays?year=2026 — merged static + DB holidays
export async function GET(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const year = req.nextUrl.searchParams.get('year') ?? new Date().getFullYear().toString();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  // Static holidays from constants
  const staticHolidays = getStaticHolidaysInRange(start, end).map((h) => ({
    ...h,
    source: 'static' as const,
  }));

  // DB holidays (ad-hoc proclamations) — RLS allows team-wide read.
  const supabase = await getSupabaseServerAuthClient();
  const { data: dbHolidays } = await supabase
    .from('ph_holidays')
    .select('*')
    .gte('date', start)
    .lte('date', end)
    .order('date');

  const dbFormatted = (dbHolidays ?? []).map((h: { id: number; date: string; name: string; type: string }) => ({
    id: h.id,
    date: h.date,
    name: h.name,
    type: h.type,
    source: 'database' as const,
  }));

  // Merge: DB overrides static for same date
  const dbDates = new Set(dbFormatted.map((h: { date: string }) => h.date));
  const merged = [
    ...staticHolidays.filter((h) => !dbDates.has(h.date)),
    ...dbFormatted,
  ].sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ data: merged });
}

// POST /api/holidays — add ad-hoc holiday (admin only)
export async function POST(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['admin', 'super_user'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { date, name, type } = body;

  if (!date || !name) {
    return NextResponse.json({ error: 'date and name are required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // RLS (ph_holidays_admin_write) gates INSERT to admin/super_user.

  const { data, error } = await supabase
    .from('ph_holidays')
    .insert({
      date,
      name,
      type: type ?? 'special_non_working',
    })
    .select()
    .single();

  if (error) {
    console.error('[holidays] POST error:', error.message);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Holiday already exists for this date' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}

// DELETE /api/holidays — remove ad-hoc holiday (admin only)
export async function DELETE(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['admin', 'super_user'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // RLS (ph_holidays_admin_write) gates DELETE to admin/super_user.

  const { error } = await supabase
    .from('ph_holidays')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[holidays] DELETE error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
