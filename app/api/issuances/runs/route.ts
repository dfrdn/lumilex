import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

const VIEWER_ROLES = ['admin', 'super_user', 'partner'];

/**
 * GET /api/issuances/runs?limit=50
 * Returns the most-recent scrape runs across all sources for the admin
 * status strip. RLS already gates the table to admin/super_user/partner; this
 * mirror check just returns a clearer 403 from the route boundary.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!VIEWER_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const limitRaw = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('issuance_scrape_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
