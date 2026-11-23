'use client';

import useSWR from 'swr';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/components/SessionProvider';
import { getSupabaseBrowserAuthClient } from '@/lib/supabase-browser';
import type { ChatChannel } from '@/types/chat';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useChatChannels() {
  const { data: session } = useSession();
  const currentUserId = session?.user?.notionUserId;

  const { data, error, isLoading, mutate } = useSWR<{
    channels: ChatChannel[];
    team: Record<string, { name: string; initials: string; role?: string; position?: string }>;
  }>('/api/chat/channels', fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  });

  const mutateRef = useRef(mutate);
  const dataRef = useRef(data);
  const currentUserIdRef = useRef(currentUserId);
  mutateRef.current = mutate;
  dataRef.current = data;
  currentUserIdRef.current = currentUserId;

  // Subscribe to new messages across all channels to trigger re-sort + toasts
  useEffect(() => {
    const supabase = getSupabaseBrowserAuthClient();
    // StrictMode in dev double-mounts effects; removeChannel from the prior mount
    // hasn't necessarily resolved before this mount runs. Clear any stale channel
    // with the same topic so .on() doesn't hit an already-subscribed instance.
    const stale = supabase.getChannels().find((c) => c.topic === 'realtime:chat:channel-list');
    if (stale) supabase.removeChannel(stale);

    const subscription = supabase
      .channel('chat:channel-list')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        (payload) => {
          mutateRef.current();

          const msg = payload.new as {
            sender_id: string;
            content: string;
            channel_id: string;
            sender_name?: string;
            entity_refs?: unknown[];
            attachments?: unknown[];
          };

          // Don't toast for own messages
          if (msg.sender_id === currentUserIdRef.current) return;

          // Only toast for channels the current user is a member of
          const channel = dataRef.current?.channels.find((ch) => ch.id === msg.channel_id);
          if (!channel) return;
          const channelName = channel.name ?? 'Chat';

          // Resolve sender name from team map
          const senderName = dataRef.current?.team[msg.sender_id]?.name
            ?? msg.sender_name
            ?? 'Someone';

          const body = msg.content
            || (Array.isArray(msg.entity_refs) && msg.entity_refs.length > 0 ? 'Shared a reference' : null)
            || (Array.isArray(msg.attachments) && msg.attachments.length > 0 ? 'Sent an attachment' : null)
            || '…';

          toast(senderName, {
            description: `${channelName}: ${body}`,
            duration: 5000,
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_channels',
        },
        () => {
          mutateRef.current();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  return {
    channels: data?.channels ?? [],
    team: data?.team ?? {},
    isLoading,
    error,
    mutate,
  };
}
