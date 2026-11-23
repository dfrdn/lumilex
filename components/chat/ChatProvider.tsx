'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useChatUnread } from '@/hooks/use-chat-unread';

interface ChatContextValue {
  isOpen: boolean;
  activeChannelId: string | null;
  totalUnread: number;
  channelUnread: Record<string, number>;
  channelMentions: Record<string, number>;
  openChat: (channelId?: string) => void;
  closeChat: () => void;
  openDm: (personId: string) => Promise<void>;
  setActiveChannel: (channelId: string | null) => void;
  refreshUnread: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

export default function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const { totalUnread, channelUnread, channelMentions, mutate: refreshUnread } = useChatUnread();

  const openChat = useCallback((channelId?: string) => {
    setIsOpen(true);
    if (channelId) setActiveChannelId(channelId);
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const openDm = useCallback(async (personId: string) => {
    try {
      const res = await fetch('/api/chat/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPersonId: personId }),
      });
      if (!res.ok) return;
      const { channel } = await res.json();
      setActiveChannelId(channel.id);
      setIsOpen(true);
    } catch {
      // Silent failure
    }
  }, []);

  const setActiveChannel = useCallback((channelId: string | null) => {
    setActiveChannelId(channelId);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        activeChannelId,
        totalUnread,
        channelUnread,
        channelMentions,
        openChat,
        closeChat,
        openDm,
        setActiveChannel,
        refreshUnread,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
