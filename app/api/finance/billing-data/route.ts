import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { fetchBillingData } from '@/lib/billing/fetch-billing-data';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const clientName = req.nextUrl.searchParams.get('clientName');
  const month = req.nextUrl.searchParams.get('month'); // YYYY-MM

  if (!clientName || !month) {
    return NextResponse.json({ error: 'clientName and month are required' }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be in YYYY-MM format' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const data = await fetchBillingData(supabase, session.firmId, clientName, month);
  return NextResponse.json(data);
}
