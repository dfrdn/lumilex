'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from '@/components/SessionProvider';
import { X, ArrowLeft, Maximize2, Search } from 'lucide-react';
import Link from 'next/link';
import { useChatContext } from './ChatProvider';
import { useChatChannels } from '@/hooks/use-chat-channels';
import { useChatMessages } from '@/hooks/use-chat-messages';
import ChannelList from './ChannelList';
import MessageThread from './MessageThread';
import MessageInput from './MessageInput';
import NewDmModal from './NewDmModal';
import ChannelInfoPanel from './ChannelInfoPanel';
import MessageSearch from './MessageSearch';
import type { MessageThreadHandle } from './MessageThread';

export default function ChatPanel({ chatBasePath = '/chat' }: { chatBasePath?: string }) {
  const { data: session } = useSession();
  const { isOpen, activeChannelId, closeChat, setActiveChannel } = useChatContext();
  const { channels, team, mutate: mutateChannels } = useChatChannels();
  const { messages, isLoading, hasMore, loadMore, sendMessage, deleteMessage, toggleReaction, readReceipts, isSending } = useChatMessages(activeChannelId);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const threadRef = useRef<MessageThreadHandle>(null);

  const currentUserId = session?.user?.notionUserId ?? '';
  const activeChannel = channels.find((ch) => ch.id === activeChannelId);

  // Keep the chat UI children mounted for 200ms after close so the exit
  // transition has something to animate from. The shell itself is ALWAYS
  // in the DOM — that's what makes the CSS transition work natively in
  // both directions without state juggling or rAF gymnastics.
  const [renderContent, setRenderContent] = useState(isOpen);
  // If isOpen flipped to true since the last render, render content now.
  // This is a render-phase update — the React-documented way to derive
  // state from props without an effect.
  if (isOpen && !renderContent) {
    setRenderContent(true);
  }
  useEffect(() => {
    if (isOpen) return;
    const timer = setTimeout(() => setRenderContent(false), 200);
    return () => clearTimeout(timer);
  }, [isOpen]);

  return (
    <>
      <div
        className={`fixed inset-0 z-30 lg:hidden bg-black/30 dark:bg-black/50 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeChat}
        aria-hidden="true"
      />
      <aside
        aria-hidden={!isOpen}
        className={`fixed right-0 top-14 bottom-0 z-40 w-full sm:w-[380px] bg-card border-l border-[var(--border-color)] shadow-[-4px_0_24px_rgba(0,0,0,0.08)] dark:shadow-[-4px_0_24px_rgba(0,0,0,0.3)] flex flex-col transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
      >
        {renderContent && activeChannelId && activeChannel ? (
          <>
            {/* Channel header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-color)]">
              <button
                onClick={() => setActiveChannel(null)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex-1 min-w-0">
                {activeChannel.type === 'matter' && activeChannel.matter_id ? (
                  <button
                    onClick={() => setShowChannelInfo(true)}
                    className="text-left w-full hover:opacity-70 transition-opacity"
                  >
                    <p className="text-sm font-semibold text-foreground truncate">
                      {activeChannel.name ?? 'Chat'}
                      {activeChannel.matter_code && (
                        <span className="text-[var(--text-muted)] font-normal"> ({activeChannel.matter_code})</span>
                      )}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {activeChannel.member_ids.length} members &middot; Tap for info
                    </p>
                  </button>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-foreground truncate">
                      {activeChannel.name ?? 'Chat'}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {activeChannel.member_ids.length} members
                    </p>
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowSearch(!showSearch)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
                aria-label="Search messages"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
              <Link
                href={`${chatBasePath}/${activeChannelId}`}
                onClick={closeChat}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
                aria-label="Open full page"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </Link>
              <button
                onClick={closeChat}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search bar */}
            {showSearch && (
              <MessageSearch
                channelId={activeChannelId}
                onClose={() => {
                  setShowSearch(false);
                  setHighlightedMessageId(null);
                }}
                onJumpToMessage={(id) => {
                  setHighlightedMessageId(id);
                  threadRef.current?.scrollToMessage(id);
                }}
              />
            )}

            {/* Messages */}
            <MessageThread
              ref={threadRef}
              messages={messages}
              isLoading={isLoading}
              hasMore={hasMore}
              loadMore={loadMore}
              currentUserId={currentUserId}
              highlightedMessageId={highlightedMessageId}
              onDeleteMessage={deleteMessage}
              onToggleReaction={(messageId, emoji) => toggleReaction(messageId, emoji, currentUserId)}
              readReceipts={readReceipts}
            />

            {/* Input. Only inherit the matter for matter-bound channels —
                DMs and group chats should start Quick Add forms blank. */}
            <MessageInput
              channelId={activeChannelId}
              channelMemberIds={activeChannel.member_ids}
              matterId={activeChannel.type === 'matter' ? activeChannel.matter_id : null}
              matterName={activeChannel.type === 'matter' ? (activeChannel.name ?? null) : null}
              onSend={sendMessage}
              isSending={isSending}
            />

            {/* Channel info overlay */}
            {activeChannel.type === 'matter' && activeChannel.matter_id && (
              <ChannelInfoPanel
                isOpen={showChannelInfo}
                onClose={() => setShowChannelInfo(false)}
                matterId={activeChannel.matter_id}
                matterName={activeChannel.name ?? 'Matter'}
                matterCode={activeChannel.matter_code}
                memberIds={activeChannel.member_ids}
                team={team}
              />
            )}
          </>
        ) : renderContent ? (
          <>
            <ChannelList onOpenNewDm={() => setShowNewDm(true)} onClose={closeChat} />
          </>
        ) : null}
      </aside>

      <NewDmModal isOpen={showNewDm} onClose={() => setShowNewDm(false)} onChannelCreated={() => mutateChannels()} />
    </>
  );
}
