'use client';

import { useState, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import { useChatContext } from './ChatProvider';

interface Props {
  matterId: string;
}

export default function MatterChatButton({ matterId }: Props) {
  const { openChat } = useChatContext();
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      // Look up the channel for this matter
      const res = await fetch('/api/chat/channels');
      if (!res.ok) return;
      const { channels } = await res.json();
      const matterChannel = channels.find(
        (ch: { type: string; matter_id: string }) => ch.type === 'matter' && ch.matter_id === matterId,
      );
      if (matterChannel) {
        openChat(matterChannel.id);
      }
    } finally {
      setLoading(false);
    }
  }, [matterId, openChat]);

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors disabled:opacity-50"
    >
      <MessageSquare className="w-3.5 h-3.5" />
      {loading ? 'Opening...' : 'Team Chat'}
    </button>
  );
}
