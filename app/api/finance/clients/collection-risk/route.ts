import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/**
 * PATCH /api/finance/clients/collection-risk
 * Flag/unflag a client as "unlikely to pay" so finance can filter them out of
 * the collectible A/R total and aging.
 * Body: { clientName: string, collectionRisk: boolean }
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { clientName, collectionRisk } = body;
  if (!clientName || typeof clientName !== 'string') {
    return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  }
  if (typeof collectionRisk !== 'boolean') {
    return NextResponse.json({ error: 'collectionRisk must be a boolean' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('clients')
    .update({ collection_risk: collectionRisk })
    .eq('name', clientName);
  if (error) {
    console.error('[finance-collection-risk]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ success: true, clientName, collectionRisk });
}
