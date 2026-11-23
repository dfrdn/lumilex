import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { computeBillingInsights } from '@/lib/finance/billing-insights';

/**
 * GET /api/finance/billing-insights?months=12
 * Leakage, payment behavior, billing-type economics, collections forecast.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  // Labor cost is derived from salaries, which admin may not see.
  if (!['super_user', 'partner', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const monthsParam = Number(req.nextUrl.searchParams.get('months'));
  const months = Number.isInteger(monthsParam) && monthsParam >= 1 && monthsParam <= 36 ? monthsParam : 12;

  const supabase = await getSupabaseServerAuthClient();
  const insights = await computeBillingInsights(supabase, session.firmId, { months });

  return NextResponse.json(insights);
}
