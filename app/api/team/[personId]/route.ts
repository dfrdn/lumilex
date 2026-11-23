import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ personId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { personId } = await params;
  const supabase = await getSupabaseServerAuthClient();

  const { data, error } = await supabase
    .from('team')
    .select('name, initials, person_id, avatar_url')
    .eq('person_id', personId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    name: data.name,
    initials: data.initials,
    avatar_url: data.avatar_url || null,
  });
}
