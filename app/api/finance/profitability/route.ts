import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { computeProfitability } from '@/lib/finance/profitability';

/**
 * GET /api/finance/profitability
 * Returns per-matter profitability report.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  // Labor cost is derived from salaries, which admin may not see.
  if (!['super_user', 'partner', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const supabase = await getSupabaseServerAuthClient();

  const results = await computeProfitability(supabase, session.firmId, {
    clientName: params.get('clientId') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  });

  const totalRevenue = results.reduce((s, r) => s + r.revenue, 0);
  const totalCost = results.reduce((s, r) => s + r.totalCost, 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  return NextResponse.json({
    matters: results,
    totalRevenue,
    totalCost,
    totalProfit,
    avgMargin,
  });
}
