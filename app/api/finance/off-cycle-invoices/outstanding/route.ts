import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { fetchAllRows } from '@/lib/supabase-paginate';
import { listOutstandingFees } from '@/lib/billing/off-cycle';

/**
 * GET /api/finance/off-cycle-invoices/outstanding?client=NAME
 * The client's matters and the one-time fees still owed on them (acceptance
 * fee, reached milestones) that no draft or pending request
 * already holds. Without `client`, the client names to pick from.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const client = req.nextUrl.searchParams.get('client');
  if (!client) {
    const rows = await fetchAllRows<{ name: string | null }>((from, to) =>
      supabase.from('clients').select('name').order('notion_id').range(from, to));
    const clients = [...new Set(rows.map((r) => r.name).filter((n): n is string => !!n))]
      .sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ clients });
  }

  return NextResponse.json(await listOutstandingFees(supabase, client));
}
