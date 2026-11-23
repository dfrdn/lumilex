import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // RLS (notifications_own_select) already scopes by person_id = current_person_id().

  // The bell badge counts only unread `action`-tier items — the things waiting
  // on this person. FYI-tier unread is surfaced as a pip on its own tab, never
  // in the red badge, so ambient updates can't overwhelm the primary signal.
  const [{ data: notifications }, { count: unreadCount }] = await Promise.all([
    supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('read', false)
      .eq('priority', 'action'),
  ]);

  return NextResponse.json({
    notifications: notifications ?? [],
    unreadCount: unreadCount ?? 0,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // RLS (notifications_own_update) ensures only own rows update.
  const body = await req.json();

  if (body.all) {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('read', false);
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    await supabase
      .from('notifications')
      .update({ read: true })
      .in('id', body.ids);
  } else {
    return NextResponse.json({ error: 'Provide { ids: string[] } or { all: true }' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
