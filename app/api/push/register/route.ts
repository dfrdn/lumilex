import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isFeatureAvailable } from '@/lib/firm/features';

const registerSchema = z.object({
  token: z.string().min(10).max(400),
  platform: z.enum(['ios', 'android']),
  app_version: z.string().max(40).optional(),
});

/**
 * POST /api/push/register
 * Register or refresh an Expo push token for the authenticated user. Bearer
 * (mobile) or cookie (web) auth via getSession(). Upserts on the token so
 * the same device re-registering just refreshes ownership and last_seen_at.
 *
 * Body: { token, platform, app_version? }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isFeatureAvailable(session.firmId, 'push'))) {
    return NextResponse.json(
      { error: 'Push notifications are not enabled for this firm.' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { token, platform, app_version } = parsed.data;
  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  const { error } = await supabase.from('chat_push_tokens').upsert(
    {
      person_id: personId,
      expo_push_token: token,
      platform,
      app_version: app_version ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'expo_push_token' },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/push/register?token=<expo-push-token>
 * Unregister a push token (on logout). Scoped to the caller — you can only
 * unregister tokens you own.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { error } = await supabase
    .from('chat_push_tokens')
    .delete()
    .eq('expo_push_token', token)
    .eq('person_id', session.user.notionUserId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
