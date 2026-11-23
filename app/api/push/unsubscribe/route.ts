import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const endpoint: string | undefined = body?.endpoint;
  const email = session.user.email.toLowerCase().trim();
  const supabase = await getSupabaseServerAuthClient();
  // RLS (push_subscriptions_own) scopes to email = current_email().

  if (endpoint) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('email', email)
      .eq('endpoint', endpoint);
  } else {
    // Drop every subscription for this user (used when they disable the
    // preference without a specific endpoint in hand).
    await supabase.from('push_subscriptions').delete().eq('email', email);
  }

  return NextResponse.json({ ok: true });
}
