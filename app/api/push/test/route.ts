import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { sendPushToEmails } from '@/lib/push';
import { isFeatureAvailable } from '@/lib/firm/features';

export async function POST() {
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

  const email = session.user.email.toLowerCase().trim();
  const supabase = await getSupabaseServerAuthClient();
  // RLS (push_subscriptions_own) scopes the count to own rows.

  // Check the user actually has a subscription before bothering to send —
  // nicer error than a silent no-op.
  const { count } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('email', email);

  if (!count || count === 0) {
    return NextResponse.json(
      { error: 'No push subscription on this device. Enable the toggle first.' },
      { status: 400 },
    );
  }

  await sendPushToEmails([email], {
    title: 'Test notification',
    body: 'If you can read this, push notifications are working.',
    href: '/dashboard/settings',
    tag: 'push-test',
  }, session.firmId);

  return NextResponse.json({ ok: true, sent: count });
}
