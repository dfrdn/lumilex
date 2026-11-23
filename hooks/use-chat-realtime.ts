'use client';

import { useEffect, useRef } from 'react';
import { getSupabaseBrowserAuthClient } from '@/lib/supabase-browser';
import type { ChatMessage } from '@/types/chat';

export interface ReactionChange {
  messageId: string;
  emoji: string;
  personId: string;
  type: 'added' | 'removed';
}

interface UseChatRealtimeOptions {
  channelId: string | null;
  onNewMessage: (message: ChatMessage) => void;
  onMessageUpdate?: (message: ChatMessage) => void;
  onChannelUpdate?: () => void;
  onReactionChange?: (change: ReactionChange) => void;
  onReadReceiptChange?: () => void;
}

/**
 * Subscribes to Supabase Realtime for new messages in a specific channel.
 */
export function useChatRealtime({ channelId, onNewMessage, onMessageUpdate, onChannelUpdate, onReactionChange, onReadReceiptChange }: UseChatRealtimeOptions) {
  const onNewMessageRef = useRef(onNewMessage);
  const onMessageUpdateRef = useRef(onMessageUpdate);
  const onChannelUpdateRef = useRef(onChannelUpdate);
  const onReactionChangeRef = useRef(onReactionChange);
  const onReadReceiptChangeRef = useRef(onReadReceiptChange);
  onNewMessageRef.current = onNewMessage;
  onMessageUpdateRef.current = onMessageUpdate;
  onChannelUpdateRef.current = onChannelUpdate;
  onReactionChangeRef.current = onReactionChange;
  onReadReceiptChangeRef.current = onReadReceiptChange;

  useEffect(() => {
    if (!channelId) return;

    const supabase = getSupabaseBrowserAuthClient();
    const subscription = supabase
      .channel(`chat:${channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          onNewMessageRef.current(payload.new as ChatMessage);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          onMessageUpdateRef.current?.(payload.new as ChatMessage);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_channels',
          filter: `id=eq.${channelId}`,
        },
        () => {
          onChannelUpdateRef.current?.();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_read_receipts',
          filter: `channel_id=eq.${channelId}`,
        },
        () => {
          onReadReceiptChangeRef.current?.();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_reactions',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const r = payload.new as { message_id: string; emoji: string; person_id: string };
          onReactionChangeRef.current?.({ messageId: r.message_id, emoji: r.emoji, personId: r.person_id, type: 'added' });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chat_reactions',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const r = payload.old as { message_id: string; emoji: string; person_id: string };
          onReactionChangeRef.current?.({ messageId: r.message_id, emoji: r.emoji, personId: r.person_id, type: 'removed' });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [channelId]);
}
