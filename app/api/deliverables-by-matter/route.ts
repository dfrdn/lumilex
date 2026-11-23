import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';

/**
 * Lightweight deliverable picker source — given a matter_id, return id+name
 * of deliverables on that matter so a liaison errand can be linked to one.
 *
 * Excludes archived/sent-out deliverables since you'd rarely link a fresh errand
 * to a closed deliverable.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) {
    return NextResponse.json({ deliverables: [] });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('deliverables')
    .select('notion_id, name, type, status')
    .eq('matter_id', matterId)
    .not('status', 'in', pgInList(CLOSED_STATUSES))
    .order('name');

  if (error) {
    console.error('[deliverables-by-matter]', error.message);
    return NextResponse.json({ error: 'Failed to load deliverables' }, { status: 500 });
  }

  const deliverables = (data ?? []).map((d) => ({
    id: d.notion_id,
    name: d.name,
    type: d.type,
    status: d.status,
  }));

  return NextResponse.json({ deliverables });
}
