import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { isFeatureAvailable } from '@/lib/firm/features';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isFeatureAvailable(session.firmId, 'push'))) {
    return NextResponse.json(
      { error: 'Push notifications are not enabled for this firm.' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  const endpoint: string | undefined = sub?.endpoint;
  const p256dh: string | undefined = sub?.keys?.p256dh;
  const auth: string | undefined = sub?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  const email = session.user.email.toLowerCase().trim();
  const userAgent = req.headers.get('user-agent') || null;
  const supabase = await getSupabaseServerAuthClient();
  // RLS (push_subscriptions_own) scopes upsert to email = current_email().

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        firm_id: session.firmId,
        email,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,endpoint' },
    );

  if (error) {
    console.error('[push/subscribe] upsert failed:', error.message);
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
