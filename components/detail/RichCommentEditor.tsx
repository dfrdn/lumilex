'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Link as LinkIcon, Link2Off, AtSign, Send, Loader2,
} from 'lucide-react';
import type { Editor } from '@tiptap/core';
import type { TeamMemberOption } from '@/lib/queries/people';

export interface RichCommentEditorHandle {
  getContent: () => { html: string; mentionIds: string[] };
  clear: () => void;
  focus: () => void;
}

interface SuggestionState {
  open: boolean;
  items: TeamMemberOption[];
  index: number;
  rect: DOMRect | null;
  onSelect?: (item: TeamMemberOption) => void;
}

interface Props {
  teamMembers: TeamMemberOption[];
  placeholder?: string;
  onSubmit?: (html: string, mentionIds: string[]) => Promise<void>;
  loading?: boolean;
  autoFocus?: boolean;
  /** Compact single-line styling for inline replies */
  compact?: boolean;
  /** Hide built-in Post button (caller renders its own Save/Cancel) */
  hideSubmit?: boolean;
  /** Pre-populate editor (edit mode) */
  initialHtml?: string;
}

interface MentionNodeJSON {
  type?: string;
  attrs?: { id?: string };
  content?: MentionNodeJSON[];
}

function extractMentionIds(doc: MentionNodeJSON): string[] {
  const ids: string[] = [];
  const walk = (node: MentionNodeJSON | undefined) => {
    if (!node) return;
    if (node.type === 'mention' && node.attrs?.id) ids.push(node.attrs.id);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  // Dedupe — the same person mentioned twice is still one notification.
  return [...new Set(ids)];
}

const RichCommentEditor = forwardRef<RichCommentEditorHandle, Props>(function RichCommentEditor({
  teamMembers,
  placeholder = 'Add a comment… use @ to mention',
  onSubmit,
  loading = false,
  autoFocus = false,
  compact = false,
  hideSubmit = false,
  initialHtml,
}, ref) {
  // Suggestion popover state — mirrored out of the TipTap suggestion lifecycle
  // so we can render it through a React portal with our own styling.
  const [suggestion, setSuggestion] = useState<SuggestionState>({
    open: false, items: [], index: 0, rect: null,
  });
  const suggestionRef = useRef(suggestion);
  suggestionRef.current = suggestion;
  const teamRef = useRef(teamMembers);
  teamRef.current = teamMembers;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({ placeholder }),
      Mention.configure({
        HTMLAttributes: {
          class: 'inline-flex items-center px-1.5 py-0.5 mx-0.5 text-[11px] font-semibold text-blue-700 bg-blue-100 rounded-md align-baseline dark:bg-blue-500/20 dark:text-blue-300',
        },
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`;
        },
        suggestion: {
          char: '@',
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            return teamRef.current
              .filter((m) =>
                !q ||
                m.name.toLowerCase().includes(q) ||
                m.initials.toLowerCase().includes(q),
              )
              .slice(0, 8);
          },
          render: () => {
            let command: ((attrs: { id: string; label: string }) => void) | null = null;
            let items: TeamMemberOption[] = [];
            let index = 0;
            let rect: DOMRect | null = null;

            const sync = () => {
              setSuggestion({
                open: true,
                items,
                index,
                rect,
                onSelect: (item) => command?.({ id: item.personId, label: item.name }),
              });
            };

            return {
              onStart: (props: {
                items: TeamMemberOption[];
                command: (attrs: { id: string; label: string }) => void;
                clientRect?: (() => DOMRect | null) | null;
              }) => {
                items = props.items;
                command = props.command;
                index = 0;
                rect = props.clientRect?.() ?? null;
                sync();
              },
              onUpdate: (props: {
                items: TeamMemberOption[];
                command: (attrs: { id: string; label: string }) => void;
                clientRect?: (() => DOMRect | null) | null;
              }) => {
                items = props.items;
                command = props.command;
                index = 0;
                rect = props.clientRect?.() ?? null;
                sync();
              },
              onKeyDown: (props: { event: KeyboardEvent }) => {
                if (!items.length) return false;
                if (props.event.key === 'Escape') {
                  setSuggestion((p) => ({ ...p, open: false }));
                  return true;
                }
                if (props.event.key === 'ArrowDown') {
                  index = (index + 1) % items.length;
                  sync();
                  return true;
                }
                if (props.event.key === 'ArrowUp') {
                  index = (index - 1 + items.length) % items.length;
                  sync();
                  return true;
                }
                if (props.event.key === 'Enter' || props.event.key === 'Tab') {
                  const item = items[index];
                  if (item) command?.({ id: item.personId, label: item.name });
                  return true;
                }
                return false;
              },
              onExit: () => {
                setSuggestion((p) => ({ ...p, open: false }));
              },
            };
          },
        },
      }),
    ],
    content: initialHtml || '',
    editorProps: {
      attributes: {
        class: `prose prose-sm prose-stone dark:prose-invert max-w-none outline-none ${
          compact
            ? 'min-h-[2.5rem] max-h-32 px-3.5 py-2 text-sm'
            : 'min-h-[5.5rem] max-h-56 px-4 py-3 text-sm'
        } text-[var(--text-primary)]`,
      },
    },
  });

  const getContent = useCallback((ed: Editor | null) => {
    if (!ed) return { html: '', mentionIds: [] as string[] };
    const html = ed.getHTML();
    const json = ed.getJSON() as MentionNodeJSON;
    return { html, mentionIds: extractMentionIds(json) };
  }, []);

  useImperativeHandle(ref, () => ({
    getContent: () => getContent(editor),
    clear: () => {
      editor?.commands.clearContent(true);
    },
    focus: () => editor?.commands.focus('end'),
  }), [editor, getContent]);

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end');
  }, [autoFocus, editor]);

  // editor.isEmpty isn't reactive — subscribe to updates so the Post button's
  // disabled state stays in sync with the actual content.
  const [isEmpty, setIsEmpty] = useState(true);
  useEffect(() => {
    if (!editor) return;
    const sync = () => setIsEmpty(editor.isEmpty);
    sync();
    editor.on('update', sync);
    return () => {
      editor.off('update', sync);
    };
  }, [editor]);

  const handleSubmit = useCallback(async () => {
    if (!editor || !onSubmit) return;
    const { html, mentionIds } = getContent(editor);
    if (editor.isEmpty) return;
    await onSubmit(html, mentionIds);
    editor.commands.clearContent(true);
  }, [editor, getContent, onSubmit]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href;
    const url = window.prompt('URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-400/15 transition-all">
      <EditorContent editor={editor} />

      {/* Toolbar + actions in one bottom rail. Toolbar appears subtly,
          no heavy gray background — just a divider. */}
      <div className="flex items-center gap-1 px-2.5 py-1.5 border-t border-[var(--border-color)]">
        <ToolbarBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (⌘B)">
          <Bold className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (⌘I)">
          <Italic className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (⌘U)">
          <UnderlineIcon className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <Strikethrough className="w-3.5 h-3.5" />
        </ToolbarBtn>

        <Divider />

        <ToolbarBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <List className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolbarBtn>

        <Divider />

        <ToolbarBtn active={editor.isActive('link')} onClick={setLink} title="Add link">
          <LinkIcon className="w-3.5 h-3.5" />
        </ToolbarBtn>
        {editor.isActive('link') && (
          <ToolbarBtn active={false} onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">
            <Link2Off className="w-3.5 h-3.5" />
          </ToolbarBtn>
        )}

        {!hideSubmit && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] hidden sm:inline-flex items-center gap-1">
              <AtSign className="w-3 h-3" /> to mention
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || isEmpty}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-[#1A1816] bg-gold-400 hover:bg-gold-500 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-[var(--subtle-bg)] disabled:text-[var(--text-muted)]"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Post
            </button>
          </div>
        )}
      </div>

      {/* Mention suggestion popover */}
      {suggestion.open && suggestion.items.length > 0 && suggestion.rect &&
        typeof window !== 'undefined' &&
        createPortal(
          <MentionDropdown state={suggestion} />,
          document.body,
        )
      }
    </div>
  );
});

export default RichCommentEditor;

function MentionDropdown({ state }: { state: SuggestionState }) {
  const { items, index, rect, onSelect } = state;
  if (!rect) return null;

  // Position the menu just below the caret, or above if there isn't room.
  const menuHeight = 220;
  const spaceBelow = window.innerHeight - rect.bottom;
  const showAbove = spaceBelow < menuHeight && rect.top > menuHeight;
  const style: React.CSSProperties = {
    position: 'fixed',
    left: rect.left,
    minWidth: 200,
    maxWidth: 280,
    zIndex: 60,
    ...(showAbove
      ? { bottom: window.innerHeight - rect.top + 4 }
      : { top: rect.bottom + 4 }),
  };

  return (
    <div
      style={style}
      className={`bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg overflow-hidden ${showAbove ? 'animate-fade-up' : 'animate-fade-down'}`}
    >
      <div className="px-3 py-1.5 border-b border-[var(--border-color)] flex items-center gap-1.5">
        <AtSign className="w-3 h-3 text-blue-500" />
        <span className="text-[11px] font-medium text-[var(--text-muted)]">Mention a team member</span>
      </div>
      <div className="max-h-44 overflow-y-auto py-0.5">
        {items.map((m, i) => (
          <button
            key={m.personId}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect?.(m);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-75 cursor-pointer text-left ${
              i === index
                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                : 'text-[var(--text-primary)] hover:bg-[var(--subtle-bg)]'
            }`}
          >
            <span
              className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0 ${
                i === index
                  ? 'bg-blue-200 dark:bg-blue-500/20 text-blue-800 dark:text-blue-200'
                  : 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
              }`}
            >
              {m.initials}
            </span>
            <span className="truncate">{m.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolbarBtn({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md transition-colors cursor-pointer ${
        active
          ? 'bg-gold-100 dark:bg-gold-500/15 text-gold-700 dark:text-gold-300'
          : 'text-[var(--text-muted)] hover:bg-[var(--subtle-bg)] hover:text-[var(--text-secondary)]'
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-[var(--border-color)] mx-0.5" />;
}
