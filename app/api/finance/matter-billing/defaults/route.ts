import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/**
 * GET /api/finance/matter-billing/defaults?matterId=...
 *
 * Returns what the BillingConfigModal needs from the matter's client:
 *   - defaultClientEmail: the client record's contact_email
 *   - clientId / clientName: whose billing profile holds the letter settings
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'finance', 'partner'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const matterId = req.nextUrl.searchParams.get('matterId');
  const supabase = await getSupabaseServerAuthClient();

  let defaultClientEmail = '';
  let clientId: string | null = null;
  let clientName: string | null = null;
  if (matterId) {
    const { data: matter } = await supabase
      .from('matters')
      .select('client_name')
      .eq('notion_id', matterId)
      .maybeSingle();
    if (matter?.client_name) {
      const { data: client } = await supabase
        .from('clients')
        .select('notion_id, name, contact_email')
        .eq('name', matter.client_name)
        .maybeSingle();
      defaultClientEmail = client?.contact_email ?? '';
      clientId = client?.notion_id ?? null;
      clientName = client?.name ?? null;
    }
  }

  return NextResponse.json({ defaultClientEmail, clientId, clientName });
}
