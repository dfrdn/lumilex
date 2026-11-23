'use client';

import { useState, useEffect, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { AtSign, Loader2, Send } from 'lucide-react';

export interface MentionMember {
  personId: string;
  name: string;
  initials: string;
}

export interface MentionEditorHandle {
  getContent: () => { text: string; mentionIds: string[] };
}

interface Props {
  teamMembers: MentionMember[];
  placeholder?: string;
  onSubmit?: (text: string, mentionIds: string[]) => Promise<void>;
  loading?: boolean;
  /** Compact single-line style for inline replies */
  compact?: boolean;
  /** Auto-focus when mounted */
  autoFocus?: boolean;
  /** Pre-populate editor with existing text and mention spans */
  initialValue?: { text: string; mentionIds: string[] };
  /** Hide built-in submit button (for external Save/Cancel buttons) */
  hideSubmit?: boolean;
}

const MentionEditor = forwardRef<MentionEditorHandle, Props>(function MentionEditor({
  teamMembers,
  placeholder = 'Add a comment... Use @ to mention',
  onSubmit,
  loading = false,
  compact = false,
  autoFocus = false,
  initialValue,
  hideSubmit = false,
}, ref) {
  const [mentions, setMentions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Pre-populate editor with initial value (for edit mode)
  useEffect(() => {
    if (!initialValue || !editorRef.current) return;
    const el = editorRef.current;
    el.innerHTML = '';

    // Build a map of mention IDs to names for rendering spans
    const memberMap = new Map(teamMembers.map((m) => [m.personId, m]));

    // Parse the text and insert mention spans where @Name patterns match
    let remaining = initialValue.text;
    const mentionIds = initialValue.mentionIds || [];

    for (const mid of mentionIds) {
      const member = memberMap.get(mid);
      if (!member) continue;
      const atName = `@${member.name}`;
      const idx = remaining.indexOf(atName);
      if (idx >= 0) {
        // Text before the mention
        if (idx > 0) {
          el.appendChild(document.createTextNode(remaining.slice(0, idx)));
        }
        // Mention span
        const span = document.createElement('span');
        span.setAttribute('data-mention-id', mid);
        span.setAttribute('contenteditable', 'false');
        span.className = 'inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 text-[11px] font-semibold text-blue-700 bg-blue-100 rounded-md align-baseline select-all dark:bg-blue-500/20 dark:text-blue-300';
        span.textContent = atName;
        el.appendChild(span);
        remaining = remaining.slice(idx + atName.length);
      }
    }
    // Remaining text after all mentions
    if (remaining) {
      el.appendChild(document.createTextNode(remaining));
    }

    setMentions(mentionIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Auto-focus
  useEffect(() => {
    if (autoFocus && editorRef.current) {
      requestAnimationFrame(() => editorRef.current?.focus());
    }
  }, [autoFocus]);

  // Calculate fixed position for the dropdown to avoid overflow-hidden clipping
  useEffect(() => {
    if (!showDropdown || !dropdownRef.current) {
      setDropdownPos(null);
      return;
    }
    const rect = dropdownRef.current.getBoundingClientRect();
    const dropdownHeight = 200; // approximate max height
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < dropdownHeight) {
      // Show above
      setDropdownPos({ bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width });
    } else {
      // Show below
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [showDropdown, query]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setShowDropdown(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [showDropdown]);

  const filteredMembers = useMemo(() => {
    const q = query.toLowerCase();
    return teamMembers
      .filter((m) => !mentions.includes(m.personId))
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.initials.toLowerCase().includes(q));
  }, [teamMembers, query, mentions]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredMembers.length, query]);

  // Extract text & mentions from contentEditable
  const getEditorContent = useCallback(() => {
    const el = editorRef.current;
    if (!el) return { text: '', mentionIds: [] as string[] };

    const mentionIds: string[] = [];
    let text = '';

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || '';
      } else if (node instanceof HTMLElement) {
        const mid = node.getAttribute('data-mention-id');
        if (mid) {
          mentionIds.push(mid);
          text += node.textContent || '';
        } else if (node.tagName === 'BR') {
          text += '\n';
        } else {
          node.childNodes.forEach(walk);
        }
      }
    };
    el.childNodes.forEach(walk);
    return { text, mentionIds };
  }, []);

  // Expose getContent for external Save buttons
  useImperativeHandle(ref, () => ({
    getContent: getEditorContent,
  }), [getEditorContent]);

  const isEditorEmpty = useCallback(() => {
    const el = editorRef.current;
    if (!el) return true;
    return el.textContent?.trim() === '';
  }, []);

  // Insert mention span at cursor
  const handleSelectMention = useCallback((member: MentionMember) => {
    const el = editorRef.current;
    if (!el) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent || '';
    const cursorOffset = range.startOffset;
    const textBefore = text.slice(0, cursorOffset);
    const lastAt = textBefore.lastIndexOf('@');
    if (lastAt < 0) return;

    const textAfter = text.slice(cursorOffset);
    const textBeforeAt = text.slice(0, lastAt);

    const mentionSpan = document.createElement('span');
    mentionSpan.setAttribute('data-mention-id', member.personId);
    mentionSpan.setAttribute('contenteditable', 'false');
    mentionSpan.className = 'inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 text-[11px] font-semibold text-blue-700 bg-blue-100 rounded-md align-baseline select-all dark:bg-blue-500/20 dark:text-blue-300';
    mentionSpan.textContent = `@${member.name}`;

    const parent = textNode.parentNode!;
    const beforeNode = document.createTextNode(textBeforeAt);
    const afterNode = document.createTextNode('\u00A0' + textAfter);

    parent.insertBefore(beforeNode, textNode);
    parent.insertBefore(mentionSpan, textNode);
    parent.insertBefore(afterNode, textNode);
    parent.removeChild(textNode);

    const newRange = document.createRange();
    newRange.setStart(afterNode, 1);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    setMentions((prev) => [...prev, member.personId]);
    setShowDropdown(false);
    setQuery('');
    setHighlightedIndex(0);
  }, []);

  // Detect @ trigger
  const handleEditorInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    const { mentionIds } = getEditorContent();
    setMentions(mentionIds);

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setShowDropdown(false);
      return;
    }

    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) {
      setShowDropdown(false);
      setQuery('');
      return;
    }

    const text = textNode.textContent || '';
    const cursorOffset = range.startOffset;
    const textBefore = text.slice(0, cursorOffset);
    const lastAt = textBefore.lastIndexOf('@');

    if (
      lastAt >= 0 &&
      (lastAt === 0 || textBefore[lastAt - 1] === ' ' || textBefore[lastAt - 1] === '\n' || textBefore[lastAt - 1] === '\u00A0')
    ) {
      const q = textBefore.slice(lastAt + 1);
      if (!q.includes(' ') && !q.includes('\n') && !q.includes('\u00A0')) {
        setShowDropdown(true);
        setQuery(q);
        return;
      }
    }
    setShowDropdown(false);
    setQuery('');
  }, [getEditorContent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (showDropdown && filteredMembers.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev + 1) % filteredMembers.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev - 1 + filteredMembers.length) % filteredMembers.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          handleSelectMention(filteredMembers[highlightedIndex]);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowDropdown(false);
          setQuery('');
        }
        return;
      }

      // Compact mode: Enter submits, Shift+Enter for newline
      if (compact && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
        return;
      }

      // Normal mode: Enter inserts <br>
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const br = document.createElement('br');
          range.insertNode(br);
          range.setStartAfter(br);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    },
    [showDropdown, filteredMembers, highlightedIndex, handleSelectMention, compact],
  );

  const handleSubmit = useCallback(async () => {
    if (!onSubmit) return;
    const { text, mentionIds } = getEditorContent();
    if (!text.trim()) return;
    await onSubmit(text.trim(), mentionIds);
    // Clear editor after successful submit
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
      setMentions([]);
    }
  }, [getEditorContent, onSubmit]);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className={compact ? 'flex items-end gap-2' : ''}>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          ref={editorRef}
          contentEditable={!loading}
          suppressContentEditableWarning
          onInput={handleEditorInput}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
          }}
          data-placeholder={placeholder}
          className={`w-full overflow-y-auto text-sm text-[var(--text-primary)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg outline-none transition-all duration-150 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--text-muted)] empty:before:pointer-events-none [&[contenteditable=false]]:opacity-50 ${
            compact ? 'min-h-[2rem] max-h-20 px-3 py-1.5 text-xs flex-1' : 'min-h-[4rem] max-h-32 px-3 py-2.5'
          }`}
        />

        {compact && !hideSubmit && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || isEditorEmpty()}
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {!compact && !hideSubmit && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-[var(--text-muted)]">
            <AtSign className="w-3 h-3 inline mr-0.5" />
            to mention
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || isEditorEmpty()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Post
          </button>
        </div>
      )}

      {/* @mention dropdown — rendered as a portal with fixed positioning to escape overflow-hidden parents */}
      {showDropdown && filteredMembers.length > 0 && dropdownPos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            ...(dropdownPos.top != null ? { top: dropdownPos.top } : {}),
            ...(dropdownPos.bottom != null ? { bottom: dropdownPos.bottom } : {}),
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 50,
          }}
          className={`bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg overflow-hidden ${dropdownPos.bottom != null ? 'animate-fade-up' : 'animate-fade-down'}`}
        >
          <div className="px-3 py-1.5 border-b border-[var(--border-color)] flex items-center gap-1.5">
            <AtSign className="w-3 h-3 text-blue-500" />
            <span className="text-[11px] font-medium text-[var(--text-muted)]">Mention a team member</span>
          </div>
          <div className="max-h-36 overflow-y-auto py-0.5">
            {filteredMembers.map((m, i) => (
              <button
                key={m.personId}
                type="button"
                onClick={() => handleSelectMention(m)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-75 cursor-pointer text-left ${
                  i === highlightedIndex
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                    : 'text-[var(--text-primary)] hover:bg-[var(--subtle-bg)]'
                }`}
              >
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0 ${
                    i === highlightedIndex ? 'bg-blue-200 dark:bg-blue-500/20 text-blue-800 dark:text-blue-200' : 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                  }`}
                >
                  {m.initials}
                </span>
                <span>{m.name}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});

export default MentionEditor;
