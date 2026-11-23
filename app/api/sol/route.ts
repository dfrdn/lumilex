import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { calculateSOLExpiry } from '@/lib/legal/date-calculator';
import { getPeriodById } from '@/lib/legal/prescriptive-periods';

async function assertAuth() {
  const session = await getSession();
  if (!session?.user) return null;
  return session;
}

function canEdit(role: string | undefined): boolean {
  return ['admin', 'super_user', 'partner'].includes(role ?? '');
}

// GET /api/sol?matterId=X — get SOL record for a matter
export async function GET(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();

  const { data, error } = await supabase
    .from('matter_sol')
    .select('*')
    .eq('matter_id', matterId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[sol] GET error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? null });
}

// POST /api/sol — create SOL record for a matter
export async function POST(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { matterId, periodId, accrualDate, tollingDays, tollingNotes } = body;

  if (!matterId || !periodId || !accrualDate) {
    return NextResponse.json({ error: 'matterId, periodId, and accrualDate are required' }, { status: 400 });
  }

  const period = getPeriodById(periodId);
  if (!period) {
    return NextResponse.json({ error: 'Invalid periodId' }, { status: 400 });
  }

  const result = calculateSOLExpiry(periodId, accrualDate, tollingDays ?? 0);
  if (!result) {
    return NextResponse.json({ error: 'Failed to calculate expiry date' }, { status: 500 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data, error } = await supabase
    .from('matter_sol')
    .insert({
      firm_id: session.firmId,
      matter_id: matterId,
      period_id: periodId,
      cause_of_action: period.causeOfAction,
      legal_basis: period.legalBasis,
      accrual_date: accrualDate,
      expiry_date: result.expiryDate,
      tolling_days: tollingDays ?? 0,
      tolling_notes: tollingNotes ?? '',
      status: 'active',
      created_by: session.user.notionUserId ?? session.user.email,
    })
    .select()
    .single();

  if (error) {
    console.error('[sol] POST error:', error.message);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'SOL record already exists for this matter' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}

// PATCH /api/sol — update tolling, status, or notes
export async function PATCH(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { id, tollingDays, tollingNotes, status } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // Get existing record to recalculate expiry if tolling changes
  const { data: existing } = await supabase
    .from('matter_sol')
    .select('*')
    .eq('id', id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'SOL record not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (status !== undefined) updates.status = status;
  if (tollingNotes !== undefined) updates.tolling_notes = tollingNotes;

  if (tollingDays !== undefined) {
    updates.tolling_days = tollingDays;
    // Recalculate expiry with new tolling
    const result = calculateSOLExpiry(existing.period_id, existing.accrual_date, tollingDays);
    if (result) {
      updates.expiry_date = result.expiryDate;
    }
  }

  const { error } = await supabase
    .from('matter_sol')
    .update(updates)
    .eq('id', id);

  if (error) {
    console.error('[sol] PATCH error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/sol — remove SOL record
export async function DELETE(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { error } = await supabase
    .from('matter_sol')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[sol] DELETE error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
