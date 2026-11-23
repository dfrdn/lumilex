import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

// Judicial-affidavit deliverables within a matter, for the review-page picker.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const matterId = searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ deliverables: [] });

  // RLS scopes to deliverables the caller can access.
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('deliverables')
    .select('notion_id, name, subtype, created_time')
    .eq('matter_id', matterId)
    .eq('subtype', 'Judicial Affidavit')
    .order('created_time', { ascending: false, nullsFirst: false })
    .limit(50);

  const deliverables = (data ?? []).map((d) => ({ id: d.notion_id, name: d.name }));
  return NextResponse.json({ deliverables });
}
