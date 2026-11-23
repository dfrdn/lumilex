import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getPartnerMattersManagementView } from '@/lib/queries/partner-matters';

const VALID_URGENCIES = ['High', 'Medium', 'Low', 'None'];
const PARTNER_ROLES = ['partner', 'super_user'];

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!PARTNER_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const data = await getPartnerMattersManagementView(session.firmId);
  return NextResponse.json(data);
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { matterId, field, value } = await req.json();

  if (!matterId || !field || !['urgency', 'notes'].includes(field)) {
    return NextResponse.json(
      { error: 'Missing or invalid fields' },
      { status: 400 },
    );
  }

  if (field === 'urgency' && !VALID_URGENCIES.includes(value)) {
    return NextResponse.json(
      { error: 'Invalid urgency value' },
      { status: 400 },
    );
  }

  const partnerId = session.user.notionUserId;
  const supabase = await getSupabaseServerAuthClient();

  try {
    const { error } = await supabase
      .from('partner_matter_annotations')
      .upsert(
        {
          firm_id: session.firmId,
          matter_id: matterId,
          partner_id: partnerId,
          [field]: value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'firm_id,matter_id,partner_id' },
      );

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[partner/matters] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
