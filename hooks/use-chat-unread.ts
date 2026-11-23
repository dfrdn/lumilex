'use client';

import useSWR from 'swr';
import { useEffect, useRef } from 'react';
import { getSupabaseBrowserAuthClient } from '@/lib/supabase-browser';
import type { ChatUnreadCounts } from '@/types/chat';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useChatUnread() {
  const { data, error, mutate } = useSWR<ChatUnreadCounts>(
    '/api/chat/unread',
    fetcher,
    { refreshInterval: 30_000 },
  );

  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  // Revalidate when new messages arrive or read receipts change
  useEffect(() => {
    const supabase = getSupabaseBrowserAuthClient();
    const subscription = supabase
      .channel('chat:unread-counter')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        () => {
          mutateRef.current();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_read_receipts',
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
    totalUnread: data?.total ?? 0,
    channelUnread: data?.channels ?? {},
    channelMentions: data?.mention_counts ?? {},
    error,
    mutate,
  };
}
