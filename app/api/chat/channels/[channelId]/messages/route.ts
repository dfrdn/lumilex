import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { sendPushToEmails } from '@/lib/push';
import { dispatchPushForMessage } from '@/lib/chat/push-dispatcher';
import { isAttachmentOfChannel } from '@/lib/chat/attachment-path';

/**
 * GET /api/chat/channels/[channelId]/messages
 * Fetch paginated messages for a channel. Cursor-based pagination via `?before=<messageId>`.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { channelId } = await params;
  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  // Verify membership
  const { data: channel } = await supabase
    .from('chat_channels')
    .select('member_ids')
    .eq('id', channelId)
    .single();

  if (!channel || !channel.member_ids.includes(personId)) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  const searchParams = req.nextUrl.searchParams;
  const before = searchParams.get('before');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);

  let query = supabase
    .from('chat_messages')
    .select('*')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    // Fetch the cursor message's created_at
    const { data: cursorMsg } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('id', before)
      .single();

    if (cursorMsg) {
      query = query.lt('created_at', cursorMsg.created_at);
    }
  }

  const { data: messages, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve sender names
  const senderIds = [...new Set((messages ?? []).map((m) => m.sender_id))];
  const { data: senders } = await supabase
    .from('team')
    .select('person_id, name, initials, avatar_url')
    .in('person_id', senderIds.length > 0 ? senderIds : ['__none__']);

  const senderMap: Record<string, { name: string; initials: string; avatar_url: string | null }> = {};
  for (const s of senders ?? []) {
    senderMap[s.person_id] = { name: s.name, initials: s.initials, avatar_url: s.avatar_url || null };
  }

  // Fetch parent messages for any reply_to_id references
  const replyIds = [...new Set((messages ?? []).map((m) => m.reply_to_id).filter(Boolean))];
  const { data: replyRows } = replyIds.length > 0
    ? await supabase
        .from('chat_messages')
        .select('id, sender_id, content, attachments, entity_refs, deleted_at')
        .in('id', replyIds)
    : { data: [] };

  const replyMap: Record<string, { id: string; sender_name: string; content: string; deleted: boolean }> = {};
  for (const r of replyRows ?? []) {
    replyMap[r.id] = {
      id: r.id,
      sender_name: senderMap[r.sender_id]?.name ?? 'Unknown',
      content: r.deleted_at
        ? '[deleted]'
        : r.content?.trim()
        || ((r.entity_refs as unknown[])?.length ? 'Reference' : '')
        || ((r.attachments as unknown[])?.length ? 'Attachment' : ''),
      deleted: !!r.deleted_at,
    };
  }

  // Fetch reactions for these messages
  const messageIds = (messages ?? []).map((m) => m.id);
  const { data: reactionRows } = messageIds.length > 0
    ? await supabase
        .from('chat_reactions')
        .select('message_id, emoji, person_id')
        .in('message_id', messageIds)
    : { data: [] };

  const reactionsMap: Record<string, Record<string, string[]>> = {};
  for (const r of reactionRows ?? []) {
    if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = {};
    if (!reactionsMap[r.message_id][r.emoji]) reactionsMap[r.message_id][r.emoji] = [];
    reactionsMap[r.message_id][r.emoji].push(r.person_id);
  }

  const enriched = (messages ?? []).map((m) => ({
    ...m,
    sender_name: senderMap[m.sender_id]?.name ?? 'Unknown',
    sender_initials: senderMap[m.sender_id]?.initials ?? '?',
    sender_avatar_url: senderMap[m.sender_id]?.avatar_url ?? null,
    reactions: reactionsMap[m.id] ?? {},
    reply_to: m.reply_to_id ? replyMap[m.reply_to_id] ?? null : null,
  }));

  // Messages come newest-first from DB; reverse for chronological display
  enriched.reverse();

  return NextResponse.json({
    messages: enriched,
    has_more: (messages ?? []).length === limit,
  });
}

/**
 * POST /api/chat/channels/[channelId]/messages
 * Send a message to a channel.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { channelId } = await params;
  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  // Verify membership
  const { data: channel } = await supabase
    .from('chat_channels')
    .select('member_ids, type, name')
    .eq('id', channelId)
    .single();

  if (!channel || !channel.member_ids.includes(personId)) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  const body = await req.json();
  const { content, entity_refs, attachments, mentions, reply_to_id } = body;

  if (!content?.trim() && (!entity_refs || entity_refs.length === 0) && (!attachments || attachments.length === 0)) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  }
  // An attachment is a storage key the sign route will later hand out; it has
  // to be one the upload route minted for this channel, not any key a client
  // chooses to put in a message.
  if (
    attachments !== undefined &&
    (!Array.isArray(attachments) ||
      attachments.some((a: { path?: unknown }) => !isAttachmentOfChannel(session.firmId, channelId, a?.path)))
  ) {
    return NextResponse.json({ error: 'Invalid attachment' }, { status: 400 });
  }

  const { data: message, error } = await supabase
    .from('chat_messages')
    .insert({
      channel_id: channelId,
      sender_id: personId,
      content: content?.trim() ?? '',
      entity_refs: entity_refs ?? [],
      attachments: attachments ?? [],
      mentions: mentions ?? [],
      reply_to_id: reply_to_id ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update channel's updated_at
  await supabase
    .from('chat_channels')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', channelId);

  // Auto-mark as read for sender
  await supabase
    .from('chat_read_receipts')
    .upsert(
      {
        channel_id: channelId,
        person_id: personId,
        last_read_at: message.created_at,
        last_read_msg_id: message.id,
      },
      { onConflict: 'channel_id,person_id' },
    );

  // Resolve sender info
  const { data: sender } = await supabase
    .from('team')
    .select('name, initials, avatar_url')
    .eq('person_id', personId)
    .single();

  // Fire-and-forget web push fan-out. Targets:
  //   - DM channel → every other member
  //   - Matter channel → only @-mentioned users
  // Gated by the per-user notify_chat preference (default on).
  (async () => {
    try {
      const isDm = channel.type === 'dm';
      const mentionIds: string[] = Array.isArray(mentions)
        ? mentions.map((m: unknown) => (typeof m === 'string' ? m : (m as { id?: string })?.id ?? '')).filter(Boolean)
        : [];
      const targetPersonIds = new Set<string>(
        isDm ? channel.member_ids.filter((id: string) => id !== personId) : mentionIds,
      );
      targetPersonIds.delete(personId);
      if (targetPersonIds.size === 0) return;

      const { data: members } = await supabase
        .from('team')
        .select('person_id, email')
        .in('person_id', [...targetPersonIds]);
      const emails = (members ?? []).map((m) => m.email).filter(Boolean);
      if (emails.length === 0) return;

      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('email, notify_chat')
        .in('email', emails);
      const optedOut = new Set(
        (prefs ?? []).filter((p) => p.notify_chat === false).map((p) => p.email),
      );
      const pushEmails = emails.filter((e) => !optedOut.has(e));
      if (pushEmails.length === 0) return;

      const senderName = sender?.name ?? session.user.name ?? 'Someone';
      const channelLabel = isDm ? senderName : (channel.name || 'chat');
      const trimmed = (content ?? '').trim();
      const body = trimmed.length > 140 ? trimmed.slice(0, 140) + '…' : trimmed;

      await sendPushToEmails(pushEmails, {
        title: isDm ? `${senderName} (DM)` : `${senderName} mentioned you in ${channelLabel}`,
        body: body || (attachments?.length ? '(attachment)' : '(new message)'),
        href: `/dashboard/chat/${channelId}`,
        tag: `chat:${channelId}`,
        entityId: channelId,
      }, session.firmId);
    } catch (err) {
      console.error('[chat push] fan-out failed:', (err as Error).message);
    }
  })();

  // Mirror the push fan-out to Expo for any registered mobile clients. The
  // dispatcher consults its own per-recipient list — duplicate sends to a
  // person who happens to have both a web push subscription and a mobile
  // device are intentional, the platforms dedupe via the `tag`.
  void dispatchPushForMessage(message.id, session.firmId);

  return NextResponse.json({
    message: {
      ...message,
      sender_name: sender?.name ?? session.user.name,
      sender_initials: sender?.initials ?? session.user.name.charAt(0),
      sender_avatar_url: sender?.avatar_url ?? null,
    },
  }, { status: 201 });
}
