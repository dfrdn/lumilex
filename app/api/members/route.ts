import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('team')
    .select('person_id, name, email, avatar_url')
    .eq('active', true)
    .order('name');

  if (error) {
    console.error('Failed to fetch team members:', error.message);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }

  const members = (data ?? []).map((m) => ({
    id: m.person_id,
    name: m.name ?? 'Unknown',
    email: m.email ?? '',
    avatar: m.avatar_url ?? null,
  }));

  return NextResponse.json(members);
}
