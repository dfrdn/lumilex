'use client';

import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { useSession } from '@/components/SessionProvider';
import { Send, Paperclip, Hash, Loader2 } from 'lucide-react';
import EntityRefPicker, { type EntityRefPickerHandle } from './EntityRefPicker';
import MentionPicker, { type MentionPickerHandle } from './MentionPicker';
import ChatQuickCreate from './ChatQuickCreate';
import type { EntityRef, ChatAttachment } from '@/types/chat';

interface Props {
  channelId: string;
  channelMemberIds?: string[];
  matterId?: string | null;
  matterName?: string | null;
  onSend: (content: string, entityRefs?: EntityRef[], attachments?: ChatAttachment[], mentions?: string[]) => Promise<unknown>;
  isSending: boolean;
}

export default function MessageInput({ channelId, channelMemberIds, matterId, matterName, onSend, isSending }: Props) {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isAdmin = role === 'admin' || role === 'super_user' || role === 'finance';
  const [content, setContent] = useState('');
  const [entityRefs, setEntityRefs] = useState<EntityRef[]>([]);
  const [showEntityPicker, setShowEntityPicker] = useState(false);
  // hashStart: index of the '#' char in content when triggered via typing
  const [hashStart, setHashStart] = useState<number | null>(null);
  const [hashQuery, setHashQuery] = useState('');
  // @mention state
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<EntityRefPickerHandle>(null);
  const mentionPickerRef = useRef<MentionPickerHandle>(null);

  const handleSend = useCallback(async () => {
    if ((!content.trim() && entityRefs.length === 0) || isSending) return;
    const mentionIds = mentions.map((m) => m.id);
    await onSend(content, entityRefs.length > 0 ? entityRefs : undefined, undefined, mentionIds.length > 0 ? mentionIds : undefined);
    setContent('');
    setEntityRefs([]);
    setHashStart(null);
    setHashQuery('');
    setShowEntityPicker(false);
    setMentions([]);
    setMentionStart(null);
    setMentionQuery('');
    setShowMentionPicker(false);
    // Reset textarea height back to single row
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    textareaRef.current?.focus();
  }, [content, entityRefs, mentions, isSending, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Delegate to mention picker first
    if (showMentionPicker && ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) {
      const consumed = mentionPickerRef.current?.handleKeyDown(e.key);
      if (consumed) {
        e.preventDefault();
        return;
      }
    }
    // Delegate navigation keys to the entity picker when it's open
    if (showEntityPicker && ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) {
      const consumed = pickerRef.current?.handleKeyDown(e.key);
      if (consumed) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // Phase 1: Get signed upload URL
      const urlRes = await fetch('/api/chat/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          file: { name: file.name, type: file.type, size: file.size },
        }),
      });
      if (!urlRes.ok) return;
      const { signedUrl, attachment } = await urlRes.json();

      // Upload directly to Supabase Storage
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!uploadRes.ok) return;

      await onSend('', undefined, [attachment]);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const addEntityRef = (ref: EntityRef) => {
    setEntityRefs((prev) => {
      if (prev.some((r) => r.type === ref.type && r.id === ref.id)) return prev;
      return [...prev, ref];
    });
    // Strip the #query text that triggered the picker
    if (hashStart !== null) {
      setContent((prev) => prev.slice(0, hashStart) + prev.slice(hashStart + 1 + hashQuery.length));
    }
    setHashStart(null);
    setHashQuery('');
    setShowEntityPicker(false);
    textareaRef.current?.focus();
  };

  const removeEntityRef = (idx: number) => {
    setEntityRefs((prev) => prev.filter((_, i) => i !== idx));
  };

  const addMention = (personId: string, name: string) => {
    setMentions((prev) => {
      if (prev.some((m) => m.id === personId)) return prev;
      return [...prev, { id: personId, name }];
    });
    // Replace @query text with @Name
    if (mentionStart !== null) {
      const before = content.slice(0, mentionStart);
      const after = content.slice(mentionStart + 1 + mentionQuery.length);
      setContent(before + `@${name} ` + after);
    }
    setMentionStart(null);
    setMentionQuery('');
    setShowMentionPicker(false);
    textareaRef.current?.focus();
  };

  const removeMention = (idx: number) => {
    setMentions((prev) => prev.filter((_, i) => i !== idx));
  };

  // Auto-resize textarea + detect # and @ triggers
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';

    const cursor = ta.selectionStart ?? val.length;
    const beforeCursor = val.slice(0, cursor);

    // Detect @ trigger: find the last @ before the cursor with no space after it
    const lastAt = beforeCursor.lastIndexOf('@');
    if (lastAt !== -1) {
      const afterAt = beforeCursor.slice(lastAt + 1);
      // Only trigger if @ is at start of input or preceded by a space
      const charBefore = lastAt > 0 ? val[lastAt - 1] : ' ';
      if ((charBefore === ' ' || charBefore === '\n' || lastAt === 0) && !afterAt.includes(' ')) {
        setMentionStart(lastAt);
        setMentionQuery(afterAt);
        setShowMentionPicker(true);
        // Close entity picker if open
        if (hashStart !== null) {
          setHashStart(null);
          setHashQuery('');
          setShowEntityPicker(false);
        }
        return;
      }
    }
    // No active @ trigger
    if (mentionStart !== null) {
      setMentionStart(null);
      setMentionQuery('');
      setShowMentionPicker(false);
    }

    // Detect # trigger: find the last # before the cursor with no space after it
    const lastHash = beforeCursor.lastIndexOf('#');
    if (lastHash !== -1) {
      const afterHash = beforeCursor.slice(lastHash + 1);
      if (!afterHash.includes(' ')) {
        setHashStart(lastHash);
        setHashQuery(afterHash);
        setShowEntityPicker(true);
        return;
      }
    }
    // No active # trigger — close picker if it was opened by typing
    if (hashStart !== null) {
      setHashStart(null);
      setHashQuery('');
      setShowEntityPicker(false);
    }
  };

  return (
    <div className="border-t border-[var(--border-color)] px-3 py-2">
      {/* Entity ref tags + mention tags */}
      {(entityRefs.length > 0 || mentions.length > 0) && (
        <div className="flex flex-wrap gap-1 mb-2">
          {mentions.map((m, i) => (
            <span
              key={`mention-${m.id}`}
              className="chat-msg-in inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-500 text-[11px] font-medium"
            >
              @{m.name}
              <button
                onClick={() => removeMention(i)}
                className="ml-0.5 hover:text-red-500 dark:hover:text-red-400"
              >
                &times;
              </button>
            </span>
          ))}
          {entityRefs.map((ref, i) => (
            <span
              key={`${ref.type}-${ref.id}`}
              className="chat-msg-in inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-[11px] font-medium"
            >
              {ref.type}: {ref.name}
              <button
                onClick={() => removeEntityRef(i)}
                className="ml-0.5 hover:text-red-500 dark:hover:text-red-400"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Mention picker */}
      {showMentionPicker && (
        <div className="mb-2">
          <MentionPicker
            ref={mentionPickerRef}
            query={mentionQuery}
            channelMemberIds={channelMemberIds}
            onSelect={addMention}
            onClose={() => {
              setMentionStart(null);
              setMentionQuery('');
              setShowMentionPicker(false);
            }}
          />
        </div>
      )}

      {/* Entity picker */}
      {showEntityPicker && (
        <div className="mb-2">
          <EntityRefPicker
            ref={pickerRef}
            matterId={matterId}
            onSelect={addEntityRef}
            onClose={() => {
              if (hashStart !== null) {
                setContent((prev) => prev.slice(0, hashStart) + prev.slice(hashStart + 1 + hashQuery.length));
              }
              setHashStart(null);
              setHashQuery('');
              setShowEntityPicker(false);
            }}
            externalQuery={hashStart !== null ? hashQuery : undefined}
          />
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* Quick create button (admin only) */}
        {isAdmin && (
          <ChatQuickCreate
            matterId={matterId}
            matterName={matterName}
            onCreated={(ref) => {
              addEntityRef(ref);
            }}
          />
        )}

        {/* Attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="shrink-0 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors disabled:opacity-50"
          aria-label="Attach file"
        >
          {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          onChange={handleFileUpload}
        />

        {/* Entity ref button */}
        <button
          onClick={() => setShowEntityPicker((v) => !v)}
          className={`shrink-0 p-1.5 rounded-lg transition-colors ${
            showEntityPicker
              ? 'text-blue-500 bg-blue-500/10'
              : 'text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]'
          }`}
          aria-label="Reference entity"
        >
          <Hash className="w-4 h-4" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... Use @ to mention"
          rows={1}
          className="flex-1 min-w-0 resize-none px-3 py-1.5 rounded-xl bg-[var(--subtle-bg)] border border-[var(--border-color)] text-sm text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-blue-500/40 max-h-[120px]"
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={isSending || (!content.trim() && entityRefs.length === 0)}
          className="shrink-0 p-2 rounded-xl bg-blue-500 text-white hover:bg-blue-600 active:scale-90 active:bg-blue-700 transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
