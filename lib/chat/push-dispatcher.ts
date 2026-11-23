import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
}

/**
 * Dispatch push notifications to all channel members who should hear about this
 * message. Fire-and-forget: callers should NOT await (we catch all errors
 * internally so it can't reject the message send).
 */
export async function dispatchPushForMessage(messageId: string, firmId: string): Promise<void> {
  try {
    const supabase = getServiceDbForFirm(firmId);

    // 1. Load the message
    const { data: message } = await supabase
      .from('chat_messages')
      .select('id, channel_id, sender_id, content, mentions, attachments, entity_refs, created_at')
      .eq('id', messageId)
      .single();
    if (!message) return;

    // 2. Load the channel
    const { data: channel } = await supabase
      .from('chat_channels')
      .select('id, type, name, matter_id, member_ids')
      .eq('id', message.channel_id)
      .single();
    if (!channel) return;

    // 3. Recipients = members minus sender
    const recipients = (channel.member_ids as string[]).filter(
      (id) => id !== message.sender_id,
    );
    if (recipients.length === 0) return;

    // 4. Filter out anyone who has muted this channel
    const { data: mutes } = await supabase
      .from('chat_mutes')
      .select('person_id, muted_until')
      .eq('channel_id', channel.id)
      .in('person_id', recipients);

    const now = new Date();
    const mutedSet = new Set(
      (mutes ?? [])
        .filter((m) => !m.muted_until || new Date(m.muted_until) > now)
        .map((m) => m.person_id),
    );
    const activeRecipients = recipients.filter((id) => !mutedSet.has(id));
    if (activeRecipients.length === 0) return;

    // 5. Load Expo push tokens for remaining recipients
    const { data: tokens } = await supabase
      .from('chat_push_tokens')
      .select('person_id, expo_push_token')
      .in('person_id', activeRecipients);
    if (!tokens || tokens.length === 0) return;

    // 6. Resolve sender name + matter name (for titles) + per-recipient
    //    unread totals so each push carries an accurate badge.
    const recipientPersonIds = Array.from(new Set(tokens.map((t) => t.person_id)));
    const [{ data: sender }, matterRes, badgeRes] = await Promise.all([
      supabase
        .from('team')
        .select('name')
        .eq('person_id', message.sender_id)
        .single(),
      channel.matter_id
        ? supabase
            .from('matters')
            .select('name')
            .eq('notion_id', channel.matter_id)
            .single()
        : Promise.resolve({ data: null as { name: string } | null }),
      // `.rpc()` passes through the scoping facade untouched, so the firm is
      // an argument here rather than something the client adds.
      supabase.rpc('chat_unread_counts', { p_firm_id: firmId, person_ids: recipientPersonIds }),
    ]);

    const senderName = sender?.name ?? 'Someone';
    const matterName = (matterRes.data as { name: string } | null)?.name ?? null;
    const badgeByPerson = new Map<string, number>();
    for (const row of (badgeRes.data as { person_id: string; unread: number }[] | null) ?? []) {
      badgeByPerson.set(row.person_id, Number(row.unread) || 0);
    }

    // 7. Build per-recipient push messages
    const bodyPreview = buildBodyPreview(message);
    const mentionSet = new Set(message.mentions as string[] ?? []);
    const isDM = channel.type === 'dm';
    const channelLabel = isDM
      ? senderName
      : matterName
        ? `${matterName}${channel.name && channel.name !== matterName ? ` · ${channel.name}` : ''}`
        : channel.name ?? 'Chat';

    const pushes: ExpoPushMessage[] = [];
    for (const t of tokens) {
      const mentioned = mentionSet.has(t.person_id);
      const title = mentioned
        ? `${senderName} mentioned you in ${channelLabel}`
        : isDM
          ? senderName
          : `${senderName} · ${channelLabel}`;
      pushes.push({
        to: t.expo_push_token,
        title,
        body: bodyPreview,
        data: {
          channelId: channel.id,
          messageId: message.id,
          type: 'chat_message',
          mention: mentioned,
        },
        sound: 'default',
        badge: badgeByPerson.get(t.person_id) ?? 0,
        priority: mentioned || isDM ? 'high' : 'default',
      });
    }

    // 8. POST to Expo in chunks of 100 (Expo limit)
    for (let i = 0; i < pushes.length; i += 100) {
      const chunk = pushes.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        console.error('[push-dispatcher] Expo HTTP error', res.status, await res.text().catch(() => ''));
        continue;
      }
      // Receipts could be polled later; for v1 we ignore.
      // Invalid tokens come back as DeviceNotRegistered — we clean those up lazily.
      const json = (await res.json().catch(() => null)) as
        | { data: Array<{ status: string; message?: string; details?: { error?: string } }> }
        | null;
      if (json?.data) {
        await cleanupInvalidTokens(supabase, chunk, json.data);
      }
    }
  } catch (err) {
    console.error('[push-dispatcher] unexpected error', err);
  }
}

function buildBodyPreview(message: {
  content: string;
  attachments: unknown[];
  entity_refs: unknown[];
}): string {
  const text = (message.content ?? '').trim();
  if (text) return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  const att = Array.isArray(message.attachments) ? message.attachments.length : 0;
  const refs = Array.isArray(message.entity_refs) ? message.entity_refs.length : 0;
  if (att && refs) return `📎 ${att} attachment${att > 1 ? 's' : ''} · ${refs} reference${refs > 1 ? 's' : ''}`;
  if (att) return `📎 ${att} attachment${att > 1 ? 's' : ''}`;
  if (refs) return `🔗 ${refs} reference${refs > 1 ? 's' : ''}`;
  return 'New message';
}

async function cleanupInvalidTokens(
  supabase: SupabaseClient,
  chunk: ExpoPushMessage[],
  results: Array<{ status: string; message?: string; details?: { error?: string } }>,
): Promise<void> {
  const bad: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
      bad.push(chunk[i].to);
    }
  }
  if (bad.length === 0) return;
  await supabase.from('chat_push_tokens').delete().in('expo_push_token', bad);
}
