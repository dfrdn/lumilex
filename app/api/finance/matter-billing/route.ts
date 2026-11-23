import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/**
 * GET /api/finance/matter-billing?matterId=X
 * Returns billing config for a matter.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('matter_billing_configs')
    .select('*')
    .eq('matter_id', matterId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? null });
}

/**
 * POST /api/finance/matter-billing
 * Create or update billing config for a matter (upsert).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  const allowed = ['admin', 'super_user', 'partner', 'finance'].includes(role);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { matterId, billingType, ...fields } = body;

  if (!matterId || !billingType) {
    return NextResponse.json({ error: 'matterId and billingType required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // Only include engagement file fields in the upsert when the body explicitly
  // sends them. Omitting a column from a Supabase upsert leaves it untouched on
  // conflict, which keeps a concurrent engagement upload from being clobbered
  // by a plain save that never carried the new path/name.
  const record: Record<string, unknown> = {
    firm_id: session.firmId,
    matter_id: matterId,
    billing_type: billingType,
    acceptance_fee: fields.acceptanceFee ?? null,
    acceptance_fee_paid: fields.acceptanceFeePaid ?? false,
    monthly_retainer: fields.monthlyRetainer ?? null,
    retainer_hours_cap: fields.retainerHoursCap ?? null,
    hourly_rate_override: fields.hourlyRateOverride ?? null,
    fixed_fee_amount: fields.fixedFeeAmount ?? null,
    success_fee_percent: fields.successFeePercent ?? null,
    success_fee_amount: fields.successFeeAmount ?? null,
    engagement_date: fields.engagementDate ?? null,
    billing_settings: fields.billingSettings ?? {},
    notes: fields.notes ?? '',
    updated_at: new Date().toISOString(),
  };
  if ('engagementFilePath' in fields) record.engagement_file_path = fields.engagementFilePath ?? null;
  if ('engagementFileName' in fields) record.engagement_file_name = fields.engagementFileName ?? null;

  const { data, error } = await supabase
    .from('matter_billing_configs')
    .upsert(record, { onConflict: 'firm_id,matter_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

/**
 * DELETE /api/finance/matter-billing?matterId=X
 * Remove billing config for a matter.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  const allowed = ['admin', 'super_user', 'partner', 'finance'].includes(role);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('matter_billing_configs')
    .delete()
    .eq('matter_id', matterId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
