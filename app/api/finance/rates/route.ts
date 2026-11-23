import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('billing_rates')
    .select('*')
    .order('hourly_rate', { ascending: false });

  if (error) {
    console.error('[finance-rates]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ rates: data });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { position, hourlyRate } = await req.json();
  if (!position || hourlyRate == null) {
    return NextResponse.json({ error: 'position and hourlyRate are required' }, { status: 400 });
  }

  const rate = Number(hourlyRate);
  if (isNaN(rate) || rate < 0 || rate > 1_000_000) {
    return NextResponse.json({ error: 'hourlyRate must be a number between 0 and 1,000,000' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('billing_rates')
    .update({ hourly_rate: rate, updated_at: new Date().toISOString() })
    .eq('position', position);

  if (error) {
    console.error('[finance-rates]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Fire-and-forget audit log
  logAudit({
    firmId: session.firmId,
    entityType: 'billing_rate',
    entityId: position,
    action: 'update',
    fieldChanged: 'hourly_rate',
    newValue: String(rate),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true });
}
