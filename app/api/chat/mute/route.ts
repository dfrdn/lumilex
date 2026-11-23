import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

const muteSchema = z.object({
  channel_id: z.string().uuid(),
  muted_until: z.string().datetime().nullable().optional(),
});

/**
 * GET /api/chat/mute
 * Returns all mutes for the authenticated user.
 *
 * Auth: Bearer (mobile) or cookie (web) via getSession().
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('chat_mutes')
    .select('channel_id, muted_until')
    .eq('person_id', session.user.notionUserId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mutes: data ?? [] });
}

/**
 * POST /api/chat/mute
 * Body: { channel_id, muted_until? } — omit or null muted_until to mute indefinitely.
 * Idempotent upsert.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = muteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { error } = await supabase.from('chat_mutes').upsert(
    {
      channel_id: parsed.data.channel_id,
      person_id: session.user.notionUserId,
      muted_until: parsed.data.muted_until ?? null,
    },
    { onConflict: 'channel_id,person_id' },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/chat/mute?channel_id=<uuid>
 * Unmute a channel.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const channelId = url.searchParams.get('channel_id');
  if (!channelId) {
    return NextResponse.json({ error: 'Missing channel_id' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { error } = await supabase
    .from('chat_mutes')
    .delete()
    .eq('channel_id', channelId)
    .eq('person_id', session.user.notionUserId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
