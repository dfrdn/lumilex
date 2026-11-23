import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

const NICKNAME_MAX = 40;

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId || !session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data: member } = await supabase
    .from('team')
    .select('name, email, position, role, start_date, initials, nickname, avatar_url')
    .eq('person_id', session.user.notionUserId)
    .eq('active', true)
    .single();

  if (!member) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    name: member.name,
    email: member.email,
    position: member.position,
    role: member.role,
    startDate: member.start_date,
    initials: member.initials,
    nickname: member.nickname ?? '',
    avatar: member.avatar_url || null,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: Record<string, string> = {};

  if ('nickname' in body) {
    const raw = body.nickname;
    if (raw !== null && typeof raw !== 'string') {
      return NextResponse.json({ error: 'nickname must be a string' }, { status: 400 });
    }
    const nickname = (raw ?? '').trim().slice(0, NICKNAME_MAX);
    update.nickname = nickname;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // RLS (team_self_update) allows the user to update their own row.
  const { error } = await supabase
    .from('team')
    .update(update)
    .eq('person_id', session.user.notionUserId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...update });
}
