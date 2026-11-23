'use client';

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import { Loader2, Trash2, Smile, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import EntityRefCard from './EntityRefCard';
import Avatar from '@/components/Avatar';
import type { ChatMessage } from '@/types/chat';
import type { ReadReceipt } from '@/hooks/use-chat-messages';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅', '🔥'];

/**
 * Attachments are private objects, so opening one means asking the server for
 * a short-lived signed URL. The tab is opened before the request, while the
 * click still counts as a user gesture, or a pop-up blocker would eat it.
 */
async function openAttachment(path: string) {
  const tab = window.open('', '_blank');
  try {
    const res = await fetch('/api/chat/sign-attachment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [path] }),
    });
    const url: string | undefined = res.ok ? (await res.json()).urls?.[path] : undefined;
    if (!url) throw new Error('not signed');
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch {
    tab?.close();
    toast.error('Could not open that attachment.');
  }
}

export interface MessageThreadHandle {
  scrollToMessage: (messageId: string) => void;
}

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  currentUserId: string;
  highlightedMessageId?: string | null;
  onDeleteMessage?: (messageId: string) => Promise<boolean>;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  readReceipts?: ReadReceipt[];
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  return d.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
}

function groupByDate(messages: ChatMessage[]): [string, ChatMessage[]][] {
  const groups: Map<string, ChatMessage[]> = new Map();
  for (const msg of messages) {
    const dateKey = new Date(msg.created_at).toDateString();
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey)!.push(msg);
  }
  return Array.from(groups.entries());
}

/** Renders message content with @mentions highlighted */
function MessageContent({ content, mentions, currentUserId, isOwn }: { content: string; mentions?: string[]; currentUserId: string; isOwn: boolean }) {
  if (!content) return null;
  // Find @Name patterns in the text and highlight them
  const mentionRegex = /@([\w\s.]+?)(?=\s@|\s*$|[.!?,;:])/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const mentionText = match[0];
    const isMentioningMe = mentions?.includes(currentUserId);
    parts.push(
      <span
        key={match.index}
        className={`font-semibold ${
          isOwn
            ? 'text-white/90 underline decoration-white/40'
            : isMentioningMe
              ? 'text-violet-600 dark:text-violet-400'
              : 'text-blue-600 dark:text-blue-400'
        }`}
      >
        {mentionText}
      </span>,
    );
    lastIndex = match.index + mentionText.length;
  }

  if (parts.length === 0) return <>{content}</>;
  if (lastIndex < content.length) parts.push(content.slice(lastIndex));
  return <>{parts}</>;
}

const MessageThread = forwardRef<MessageThreadHandle, Props>(function MessageThread(
  { messages, isLoading, hasMore, loadMore, currentUserId, highlightedMessageId, onDeleteMessage, onToggleReaction, readReceipts = [] },
  ref,
) {
  // Build map: messageId → list of readers (excluding current user)
  const readersPerMessage: Record<string, { initials: string; name: string }[]> = {};
  for (const receipt of readReceipts) {
    if (!receipt.last_read_msg_id || receipt.person_id === currentUserId) continue;
    if (!readersPerMessage[receipt.last_read_msg_id]) readersPerMessage[receipt.last_read_msg_id] = [];
    readersPerMessage[receipt.last_read_msg_id].push({ initials: receipt.initials, name: receipt.name });
  }

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const knownIdsRef = useRef(new Set<string>());
  const [newMessageIds, setNewMessageIds] = useState(new Set<string>());
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);

  useImperativeHandle(ref, () => ({
    scrollToMessage(messageId: string) {
      const el = containerRef.current?.querySelector(`[data-message-id="${messageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
  }));

  // Track which messages are new (arrived after initial load)
  useEffect(() => {
    if (messages.length === 0) return;
    const incoming = new Set<string>();
    for (const msg of messages) {
      if (!knownIdsRef.current.has(msg.id)) {
        if (prevLengthRef.current > 0) incoming.add(msg.id);
        knownIdsRef.current.add(msg.id);
      }
    }
    if (incoming.size > 0) {
      setNewMessageIds((prev) => new Set([...prev, ...incoming]));
      setTimeout(() => {
        setNewMessageIds((prev) => {
          const next = new Set(prev);
          for (const id of incoming) next.delete(id);
          return next;
        });
      }, 500);
    }
    prevLengthRef.current = messages.length;
  }, [messages]);

  // Auto-scroll to bottom on new messages (only if already near bottom)
  useEffect(() => {
    if (messages.length <= 1) return;
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the scroll position is only readable from the DOM after a render
      setUnreadWhileScrolled(0);
    } else if (prevLengthRef.current > 0) {
      setUnreadWhileScrolled((n) => n + 1);
    }
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      bottomRef.current?.scrollIntoView();
    }
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setShowScrollBtn(!isNearBottom);
    if (isNearBottom) setUnreadWhileScrolled(0);
    if (!hasMore) return;
    if (el.scrollTop < 100) loadMore();
  }, [hasMore, loadMore]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollBtn(false);
    setUnreadWhileScrolled(0);
  }

  const dateGroups = groupByDate(messages);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
        <p className="text-sm">No messages yet. Start the conversation!</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-3 py-2 space-y-1"
    >
        {hasMore && (
          <button
            onClick={loadMore}
            className="w-full text-center text-xs text-[var(--text-muted)] hover:text-foreground py-2"
          >
            Load earlier messages
          </button>
        )}

        {dateGroups.map(([dateKey, msgs]) => (
          <div key={dateKey}>
            {/* Date separator */}
            <div className="flex items-center gap-3 py-3">
              <div className="flex-1 h-px bg-[var(--border-color)]" />
              <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {formatDateLabel(msgs[0].created_at)}
              </span>
              <div className="flex-1 h-px bg-[var(--border-color)]" />
            </div>

            {/* Messages */}
            {msgs.map((msg, i) => {
              const isOwn = msg.sender_id === currentUserId;
              const prevMsg = i > 0 ? msgs[i - 1] : null;
              const isConsecutive =
                prevMsg?.sender_id === msg.sender_id &&
                new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 120_000;
              const isHighlighted = highlightedMessageId === msg.id;
              const isNew = newMessageIds.has(msg.id);

              return (
                <div
                  key={msg.id}
                  data-message-id={msg.id}
                  className={`group flex gap-2.5 ${isConsecutive ? 'mt-0.5' : 'mt-3'} ${isOwn ? 'flex-row-reverse' : ''} ${isNew ? 'chat-msg-in' : ''} ${isHighlighted ? 'bg-yellow-500/10 rounded-lg -mx-1 px-1 py-0.5 transition-colors duration-1000' : ''}`}
                >
                  {/* Avatar */}
                  {!isConsecutive ? (
                    <Avatar
                      size={28}
                      avatarUrl={msg.sender_avatar_url}
                      initials={msg.sender_initials ?? msg.sender_name?.charAt(0) ?? '?'}
                      name={msg.sender_name}
                      fallbackClassName={
                        isOwn
                          ? 'bg-blue-500/15 text-blue-500'
                          : 'bg-[var(--subtle-bg)] text-[var(--text-muted)]'
                      }
                    />
                  ) : (
                    <div className="w-7 shrink-0" />
                  )}

                  {/* Bubble */}
                  <div className={`max-w-[75%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                    {!isConsecutive && (
                      <div className={`flex items-center gap-2 mb-0.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                        <span className="text-xs font-medium text-foreground">
                          {isOwn ? 'You' : msg.sender_name}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {formatMessageTime(msg.created_at)}
                        </span>
                      </div>
                    )}

                    {msg.content && (
                      <div
                        className={`px-3 py-1.5 rounded-2xl text-sm leading-relaxed break-words ${
                          isOwn
                            ? 'bg-blue-500 text-white rounded-tr-md'
                            : !isOwn && msg.mentions?.includes(currentUserId)
                              ? 'bg-violet-500/10 border border-violet-500/20 text-foreground rounded-tl-md'
                              : 'bg-[var(--subtle-bg)] text-foreground rounded-tl-md'
                        }`}
                      >
                        <MessageContent content={msg.content} mentions={msg.mentions} currentUserId={currentUserId} isOwn={isOwn} />
                      </div>
                    )}

                    {/* Entity references */}
                    {msg.entity_refs?.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {msg.entity_refs.map((ref) => (
                          <EntityRefCard key={`${ref.type}-${ref.id}`} entityRef={ref} />
                        ))}
                      </div>
                    )}

                    {/* Attachments */}
                    {msg.attachments?.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {msg.attachments.map((att, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => openAttachment(att.path)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)] text-xs text-left cursor-pointer hover:border-gold-300 dark:hover:border-gold-500/40 transition-colors"
                          >
                            <Paperclip className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                            <span className="truncate text-foreground">{att.name}</span>
                            <span className="text-[var(--text-muted)] shrink-0">
                              {(att.size / 1024).toFixed(0)}KB
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Reactions */}
                    {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : ''}`}>
                        {Object.entries(msg.reactions).map(([emoji, personIds]) => {
                          const hasReacted = personIds.includes(currentUserId);
                          return (
                            <button
                              key={emoji}
                              onClick={() => onToggleReaction?.(msg.id, emoji)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors active:scale-90 ${
                                hasReacted
                                  ? 'bg-blue-500/15 border-blue-500/40 text-blue-500'
                                  : 'bg-[var(--subtle-bg)] border-[var(--border-color)] text-foreground hover:border-blue-500/40'
                              }`}
                            >
                              <span>{emoji}</span>
                              <span className="font-medium">{personIds.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Timestamp for consecutive messages */}
                    {isConsecutive && (
                      <span className={`text-[9px] text-[var(--text-muted)] ${isOwn ? 'text-right block' : ''}`}>
                        {formatMessageTime(msg.created_at)}
                      </span>
                    )}

                    {/* Read receipts — stacked avatars */}
                    {readersPerMessage[msg.id]?.length > 0 && (
                      <ReadReceiptStack readers={readersPerMessage[msg.id]} isOwn={isOwn} />
                    )}

                    {/* Hover actions */}
                    {(onToggleReaction || (isOwn && onDeleteMessage)) && (
                      <div className={`flex items-center gap-0.5 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isOwn ? 'self-end' : 'self-start'}`}>
                        {onToggleReaction && (
                          <ReactionPickerButton messageId={msg.id} onToggle={onToggleReaction} />
                        )}
                        {isOwn && onDeleteMessage && (
                          <UnsendButton messageId={msg.id} onConfirm={onDeleteMessage} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Scroll-to-bottom button */}
        {showScrollBtn && (
          <div className="sticky bottom-2 flex justify-center z-10 pointer-events-none">
            <button
              onClick={scrollToBottom}
              className="chat-scroll-btn pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500 text-white text-xs font-medium shadow-lg hover:bg-blue-600 active:scale-95 transition-transform"
            >
              {unreadWhileScrolled > 0 && (
                <span className="bg-white text-blue-500 text-[10px] font-bold rounded-full px-1.5 py-0 leading-4 min-w-[18px] text-center dark:bg-stone-900">
                  {unreadWhileScrolled}
                </span>
              )}
              {unreadWhileScrolled > 0 ? 'New messages' : 'Jump to bottom'}
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
  );
});

const MAX_VISIBLE_READERS = 3;

function ReadReceiptStack({ readers, isOwn }: { readers: { initials: string; name: string }[]; isOwn: boolean }) {
  const visible = readers.slice(0, MAX_VISIBLE_READERS);
  const overflow = readers.length - MAX_VISIBLE_READERS;
  const allNames = readers.map((r) => r.name).join(', ');

  return (
    <div
      className={`flex items-center mt-1 ${isOwn ? 'justify-end' : ''}`}
      title={`Read by ${allNames}`}
    >
      <div className="flex items-center -space-x-1.5">
        {visible.map((r, i) => (
          <div
            key={r.initials + r.name}
            className="w-4 h-4 rounded-full bg-[var(--subtle-bg)] border-2 border-card flex items-center justify-center text-[6px] font-semibold text-[var(--text-muted)]"
            style={{ zIndex: MAX_VISIBLE_READERS - i }}
          >
            {r.initials}
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <span className="group/readers relative ml-1 text-[9px] text-[var(--text-muted)] cursor-default">
          +{overflow}
          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/readers:flex flex-col items-center z-50">
            <span className="rounded-md bg-foreground text-background px-2 py-1.5 shadow-lg flex flex-col gap-0.5">
              {readers.map((r) => (
                <span key={r.name} className="text-[10px] leading-tight whitespace-nowrap">{r.name}</span>
              ))}
            </span>
            <span className="w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] border-l-transparent border-r-transparent border-t-foreground -mt-px" />
          </span>
        </span>
      )}
      {readers.length <= MAX_VISIBLE_READERS && (
        <span className="ml-1 text-[9px] text-[var(--text-muted)]">Read</span>
      )}
    </div>
  );
}

function ReactionPickerButton({ messageId, onToggle }: { messageId: string; onToggle: (id: string, emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1 rounded text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
        title="Add reaction"
      >
        <Smile className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="chat-popover-in absolute bottom-full mb-1 left-0 z-50 flex gap-1 p-1.5 rounded-xl bg-card border border-[var(--border-color)] shadow-lg">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => { onToggle(messageId, emoji); setOpen(false); }}
              className="text-base leading-none p-1 rounded-lg hover:scale-125 hover:bg-[var(--subtle-bg)] transition-transform duration-100"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UnsendButton({ messageId, onConfirm }: { messageId: string; onConfirm: (id: string) => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1 bg-card border border-[var(--border-color)] rounded-lg px-2 py-1 shadow-sm">
        <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">Unsend?</span>
        <button
          onClick={() => { onConfirm(messageId); setConfirming(false); }}
          className="text-[10px] font-semibold text-red-500 hover:text-red-600 transition-colors px-1 dark:text-red-400"
        >
          Yes
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[10px] text-[var(--text-muted)] hover:text-foreground transition-colors px-1"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="p-1 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors dark:hover:text-red-400"
      title="Unsend"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

export default MessageThread;
