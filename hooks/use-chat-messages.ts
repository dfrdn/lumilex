'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import useSWR from 'swr';
import { useChatRealtime } from './use-chat-realtime';
import type { ChatMessage } from '@/types/chat';

export interface ReadReceipt {
  person_id: string;
  last_read_msg_id: string | null;
  initials: string;
  name: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useChatMessages(channelId: string | null) {
  const [realtimeMessages, setRealtimeMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  // Reactions cache: messageId → emoji → person_ids[] (tracks realtime + optimistic updates)
  const [reactionsCache, setReactionsCache] = useState<Record<string, Record<string, string[]>>>({});
  const currentChannelRef = useRef(channelId);

  // Reset realtime messages and reactions cache when channel changes
  useEffect(() => {
    if (channelId !== currentChannelRef.current) {
      setRealtimeMessages([]);
      setReactionsCache({});
      currentChannelRef.current = channelId;
    }
  }, [channelId]);

  const { data, error, isLoading, mutate } = useSWR<{
    messages: ChatMessage[];
    has_more: boolean;
  }>(
    channelId ? `/api/chat/channels/${channelId}/messages` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const { data: receiptsData, mutate: mutateReceipts } = useSWR<{ receipts: ReadReceipt[] }>(
    channelId ? `/api/chat/channels/${channelId}/read-receipts` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  // Handle realtime messages
  const seenIdsRef = useRef(new Set<string>());

  // Cache sender info resolved from realtime messages
  const senderCacheRef = useRef<Record<string, { name: string; initials: string; avatar_url: string | null }>>({});

  useChatRealtime({
    channelId,
    onNewMessage: useCallback(async (msg: ChatMessage) => {
      if (seenIdsRef.current.has(msg.id)) return;
      seenIdsRef.current.add(msg.id);

      // Realtime payloads are raw DB rows without sender_name/sender_initials.
      // Resolve from cache or fetch once.
      if (!msg.sender_name && msg.sender_id) {
        const cached = senderCacheRef.current[msg.sender_id];
        if (cached) {
          msg = { ...msg, sender_name: cached.name, sender_initials: cached.initials, sender_avatar_url: cached.avatar_url };
        } else {
          try {
            const res = await fetch(`/api/team/${msg.sender_id}`);
            if (res.ok) {
              const info = await res.json();
              senderCacheRef.current[msg.sender_id] = { name: info.name, initials: info.initials, avatar_url: info.avatar_url ?? null };
              msg = { ...msg, sender_name: info.name, sender_initials: info.initials, sender_avatar_url: info.avatar_url ?? null };
            }
          } catch { /* use fallback */ }
        }
      }

      setRealtimeMessages((prev) => [...prev, msg]);

      // Mark as read since channel is open
      if (channelId) {
        fetch(`/api/chat/channels/${channelId}/read`, { method: 'POST' }).catch(() => {});
      }
    }, [channelId]),
    onMessageUpdate: useCallback((msg: ChatMessage) => {
      // Handle soft deletes — remove from realtime messages if deleted_at is set
      if (msg.deleted_at) {
        setRealtimeMessages((prev) => prev.filter((m) => m.id !== msg.id));
        mutate(
          (current) => current
            ? { ...current, messages: current.messages.filter((m) => m.id !== msg.id) }
            : current,
          false,
        );
      }
    }, [mutate]),
    onReadReceiptChange: useCallback(() => {
      mutateReceipts();
    }, [mutateReceipts]),
    onReactionChange: useCallback(({ messageId, emoji, personId, type }: { messageId: string; emoji: string; personId: string; type: 'added' | 'removed' }) => {
      setReactionsCache((prev) => {
        const msgReactions = { ...(prev[messageId] ?? {}) };
        const existing = msgReactions[emoji] ? [...msgReactions[emoji]] : [];
        if (type === 'added' && !existing.includes(personId)) {
          msgReactions[emoji] = [...existing, personId];
        } else if (type === 'removed') {
          const filtered = existing.filter((id) => id !== personId);
          if (filtered.length === 0) {
            delete msgReactions[emoji];
          } else {
            msgReactions[emoji] = filtered;
          }
        }
        return { ...prev, [messageId]: msgReactions };
      });
    }, []),
  });

  // Merge fetched + realtime messages, deduplicate by ID, apply reactions cache
  const fetchedMessages = data?.messages ?? [];
  const seen = new Set<string>();
  const allMessages: ChatMessage[] = [];
  for (const m of [...fetchedMessages, ...realtimeMessages]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      // Apply reactions cache on top of fetched reactions (cache wins for realtime updates)
      const cachedReactions = reactionsCache[m.id];
      allMessages.push(cachedReactions !== undefined ? { ...m, reactions: cachedReactions } : m);
    }
  }

  const sendMessage = useCallback(
    async (content: string, entityRefs?: ChatMessage['entity_refs'], attachments?: ChatMessage['attachments'], mentions?: string[]) => {
      if (!channelId) return null;
      setIsSending(true);
      try {
        const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, entity_refs: entityRefs, attachments, mentions }),
        });
        if (!res.ok) return null;
        const { message } = await res.json();
        // Add to seen so realtime doesn't duplicate
        seenIdsRef.current.add(message.id);
        // Replace if realtime already added a raw version, otherwise append
        setRealtimeMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === message.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = message;
            return updated;
          }
          return [...prev, message];
        });
        return message;
      } finally {
        setIsSending(false);
      }
    },
    [channelId],
  );

  const deleteMessage = useCallback(async (messageId: string) => {
    if (!channelId) return false;
    // Optimistic removal
    setRealtimeMessages((prev) => prev.filter((m) => m.id !== messageId));
    mutate(
      (current) => current
        ? { ...current, messages: current.messages.filter((m) => m.id !== messageId) }
        : current,
      false,
    );
    const res = await fetch(`/api/chat/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      // Revert on failure
      mutate();
    }
    return res.ok;
  }, [channelId, mutate]);

  const loadMore = useCallback(async () => {
    if (!channelId || !fetchedMessages.length) return;
    const oldestId = fetchedMessages[0]?.id;
    if (!oldestId) return;

    const res = await fetch(`/api/chat/channels/${channelId}/messages?before=${oldestId}`);
    if (!res.ok) return;
    const { messages: olderMessages } = await res.json();
    if (olderMessages?.length) {
      mutate(
        (current) => ({
          messages: [...olderMessages, ...(current?.messages ?? [])],
          has_more: olderMessages.length === 50,
        }),
        false,
      );
    }
  }, [channelId, fetchedMessages, mutate]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string, currentUserId: string) => {
    if (!channelId) return;
    // Optimistic update
    setReactionsCache((prev) => {
      const msgReactions = { ...(prev[messageId] ?? {}) };
      const existing = msgReactions[emoji] ? [...msgReactions[emoji]] : [];
      if (existing.includes(currentUserId)) {
        const filtered = existing.filter((id) => id !== currentUserId);
        if (filtered.length === 0) delete msgReactions[emoji];
        else msgReactions[emoji] = filtered;
      } else {
        msgReactions[emoji] = [...existing, currentUserId];
      }
      return { ...prev, [messageId]: msgReactions };
    });
    await fetch(`/api/chat/channels/${channelId}/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
  }, [channelId]);

  return {
    messages: allMessages,
    isLoading,
    isSending,
    error,
    hasMore: data?.has_more ?? false,
    readReceipts: receiptsData?.receipts ?? [],
    sendMessage,
    deleteMessage,
    toggleReaction,
    loadMore,
    mutate,
  };
}
