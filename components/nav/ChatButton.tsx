'use client';

import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { useChatContext } from '@/components/chat/ChatProvider';
import { useHydrated } from '@/hooks/use-page-visits';

const ICON_BUTTON =
  'relative p-2 rounded-lg text-navy-400 dark:text-[#9B978F] hover:text-white hover:bg-navy-800 dark:hover:bg-[#232326] transition-colors duration-150';

/**
 * Chat in a shell's header, with the person's unread count, which ChatProvider
 * keeps live over Realtime. Where the shell mounts the side panel
 * (DetailPaneWrapper), the button opens and closes it on wider screens; on a
 * phone, and in shells without the panel, it opens /chat.
 */
export default function ChatButton({ panel = true }: { panel?: boolean }) {
  const { isOpen, openChat, closeChat, totalUnread } = useChatContext();
  // SWR restores the count from localStorage before the first client render,
  // which the server never sees; the badge waits for mount so hydration matches.
  const unread = useHydrated() ? totalUnread : 0;
  const badge = unread > 0 && (
    <span
      aria-hidden
      className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-gold-400 text-navy-900 text-[10px] font-bold leading-none tabular-nums"
    >
      {unread > 99 ? '99+' : unread}
    </span>
  );

  return (
    <>
      <Link
        href="/chat"
        prefetch={false}
        aria-label="Chat"
        title="Chat"
        className={`${ICON_BUTTON} ${panel ? 'flex sm:hidden' : 'flex'}`}
      >
        <MessageSquare className="w-[18px] h-[18px]" />
        {badge}
      </Link>
      {panel && (
        <button
          type="button"
          onClick={() => (isOpen ? closeChat() : openChat())}
          aria-label="Chat"
          aria-expanded={isOpen}
          title="Chat"
          className={`${ICON_BUTTON} hidden sm:flex`}
        >
          <MessageSquare className="w-[18px] h-[18px]" />
          {badge}
        </button>
      )}
    </>
  );
}
