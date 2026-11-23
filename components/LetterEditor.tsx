'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension, Node, mergeAttributes, type Extensions } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link as LinkIcon, Link2Off, List, ListOrdered, Plus, Strikethrough, Underline as UnderlineIcon } from 'lucide-react';
import { canonicalKey, chipsToTokens, tokenPattern, tokensToChips, type LetterPlaceholder } from '@/lib/letter-placeholders';

/**
 * The editor for a letter's subject (one line, no formatting) or message —
 * paragraphs with bold, italic and underline; with `formatting="lists"`
 * numbered lists too, and with `formatting="full"` strike, lists and links.
 * Each of `placeholders` shows as a chip that can't be typed into; the value
 * handed back always carries the `{{key}}` tokens. The one editor for wording
 * the firm edits — the billing letter and email, the trademark reports; stored
 * wording converts at its edge with lib/letter-markup.ts.
 */

export const PLACEHOLDER_CHIP =
  'inline-block rounded-md border border-dashed border-gold-500/70 bg-gold-50 px-1.5 mx-px text-[0.85em] leading-snug font-medium text-gold-800 whitespace-nowrap select-none align-baseline dark:bg-gold-400/10 dark:text-gold-300 dark:border-gold-400/60';

function placeholderChip(set: readonly LetterPlaceholder[]) {
  const keys = set.map((p) => p.key);
  const byKey = Object.fromEntries(set.map((p) => [p.key, p]));
  return Node.create({
    name: 'letterPlaceholder',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
      return {
        key: {
          default: keys[0] ?? '',
          parseHTML: (el) => el.getAttribute('data-placeholder'),
          renderHTML: (attrs) => ({ 'data-placeholder': attrs.key }),
        },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-placeholder]', getAttrs: (el) => (keys.includes((el as HTMLElement).getAttribute('data-placeholder') ?? '') ? null : false) }];
    },

    renderHTML({ node, HTMLAttributes }) {
      const p = byKey[node.attrs.key as string];
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          class: `${PLACEHOLDER_CHIP} [&.ProseMirror-selectednode]:ring-2 [&.ProseMirror-selectednode]:ring-gold-400`,
          contenteditable: 'false',
          title: `Filled in with ${p?.meaning ?? 'the letter\u2019s details'}`,
        }),
        p?.label ?? node.attrs.key,
      ];
    },

    renderText({ node }) {
      return `{{${node.attrs.key}}}`;
    },

    // A token however it arrives — typed, pasted, autocorrected — becomes a chip.
    addProseMirrorPlugins() {
      const type = this.type;
      return [
        new Plugin({
          key: new PluginKey('letterPlaceholderTokens'),
          appendTransaction(transactions, _old, state) {
            if (!transactions.some((t) => t.docChanged)) return null;
            const found: { from: number; to: number; key: string }[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const m of node.text.matchAll(tokenPattern(keys))) {
                found.push({ from: pos + m.index, to: pos + m.index + m[0].length, key: canonicalKey(keys, m[1]) });
              }
            });
            if (found.length === 0) return null;
            const tr = state.tr;
            for (const f of found.reverse()) tr.replaceWith(f.from, f.to, type.create({ key: f.key }));
            return tr;
          },
        }),
      ];
    },
  });
}

/** A document of exactly one paragraph, for the subject. */
const OneLine = Node.create({ name: 'doc', topNode: true, content: 'paragraph' });
const NoNewLines = Extension.create({
  name: 'noNewLines',
  addKeyboardShortcuts() {
    return { Enter: () => true, 'Shift-Enter': () => true, 'Mod-Enter': () => true };
  },
});

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface LetterEditorHandle {
  insertPlaceholder: (key: string) => void;
}

interface Props {
  id: string;
  variant: 'line' | 'rich';
  /** The subject as plain text, or the message as letter HTML; tokens, not chips. */
  value: string;
  onChange: (value: string) => void;
  /** The fields this letter fills in, shown as chips. None by default. */
  placeholders?: readonly LetterPlaceholder[];
  /** 'lists' adds numbered lists to bold, italic and underline; 'full' adds strike, both lists and links. */
  formatting?: 'full' | 'lists' | 'basic';
  disabled?: boolean;
  onFocus?: () => void;
  ariaLabel: string;
}

const LetterEditor = forwardRef<LetterEditorHandle, Props>(function LetterEditor(
  { id, variant, value, onChange, placeholders, formatting = 'full', disabled = false, onFocus, ariaLabel },
  ref,
) {
  const line = variant === 'line';
  const full = formatting === 'full';
  const numbered = full || formatting === 'lists';
  const keys = (placeholders ?? []).map((p) => p.key);
  const keyList = keys.join('|');
  const toContent = useCallback(
    (v: string) => {
      const html = line ? `<p>${escapeText(v)}</p>` : v;
      return keyList ? tokensToChips(html, keyList.split('|')) : html;
    },
    [line, keyList],
  );
  const emitted = useRef(value);
  const onChangeRef = useRef(onChange);
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onChangeRef.current = onChange;
    onFocusRef.current = onFocus;
  });

  const extensions: Extensions = line
    ? [
        OneLine,
        StarterKit.configure({
          document: false,
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          codeBlock: false,
          code: false,
          horizontalRule: false,
          hardBreak: false,
          bold: false,
          italic: false,
          strike: false,
          underline: false,
          link: false,
          trailingNode: false,
        }),
        NoNewLines,
      ]
    : [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          codeBlock: false,
          code: false,
          horizontalRule: false,
          ...(full
            ? { link: { openOnClick: false, autolink: true, HTMLAttributes: { target: null, rel: null } } }
            : numbered
              ? { strike: false, bulletList: false, link: false }
              : { strike: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, link: false }),
        }),
      ];
  if (placeholders?.length) extensions.push(placeholderChip(placeholders));

  const editor = useEditor({
    immediatelyRender: false,
    // The toolbar shows which marks are on at the cursor.
    shouldRerenderOnTransaction: !line,
    editable: !disabled,
    extensions,
    content: toContent(value),
    onUpdate: ({ editor: e }) => {
      const next = line ? e.getText().replace(/\s+/g, ' ') : chipsToTokens(e.getHTML());
      emitted.current = next;
      onChangeRef.current(next);
    },
    onFocus: () => onFocusRef.current?.(),
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-label': ariaLabel,
        ...(line ? {} : { 'aria-multiline': 'true' }),
        class: line
          ? 'outline-none px-3 py-2 text-sm text-foreground whitespace-nowrap overflow-x-auto [&_p]:m-0'
          : 'outline-none px-3 py-2.5 min-h-[240px] max-h-[520px] overflow-y-auto text-sm leading-relaxed text-foreground [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li_p]:mb-1 [&_a]:underline [&_a]:text-navy-700 dark:[&_a]:text-gold-300',
      },
    },
  });

  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(toContent(value), { emitUpdate: false });
  }, [editor, value, toContent]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useImperativeHandle(
    ref,
    () => ({
      insertPlaceholder: (key) => editor?.chain().focus().insertContent({ type: 'letterPlaceholder', attrs: { key } }).run(),
    }),
    [editor],
  );

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link address', prev ?? 'https://');
    if (url === null) return;
    if (url.trim() === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }, [editor]);

  const frame = `rounded-lg border border-[var(--border-color)] bg-transparent focus-within:border-gold-400 transition-colors ${disabled ? 'opacity-60' : ''}`;

  if (line || !editor) {
    return (
      <div className={frame}>
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div className={`${frame} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-[var(--border-color)] bg-stone-50/70 dark:bg-white/[0.03]">
        <Tool active={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (⌘B)">
          <Bold className="w-3.5 h-3.5" />
        </Tool>
        <Tool active={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (⌘I)">
          <Italic className="w-3.5 h-3.5" />
        </Tool>
        <Tool active={editor.isActive('underline')} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (⌘U)">
          <UnderlineIcon className="w-3.5 h-3.5" />
        </Tool>
        {full && (
          <Tool active={editor.isActive('strike')} disabled={disabled} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
            <Strikethrough className="w-3.5 h-3.5" />
          </Tool>
        )}
        {numbered && <span className="mx-1 h-4 w-px bg-stone-200 dark:bg-white/10" />}
        {full && (
          <Tool active={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bulleted list">
            <List className="w-3.5 h-3.5" />
          </Tool>
        )}
        {numbered && (
          <Tool active={editor.isActive('orderedList')} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
            <ListOrdered className="w-3.5 h-3.5" />
          </Tool>
        )}
        {full && (<>
        <span className="mx-1 h-4 w-px bg-stone-200 dark:bg-white/10" />
        <Tool active={editor.isActive('link')} disabled={disabled} onClick={setLink} title="Link">
          <LinkIcon className="w-3.5 h-3.5" />
        </Tool>
        {editor.isActive('link') && (
          <Tool active={false} disabled={disabled} onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()} title="Remove link">
            <Link2Off className="w-3.5 h-3.5" />
          </Tool>
        )}
        </>)}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
});

export default LetterEditor;

const PLACEHOLDER_BUTTON = `${PLACEHOLDER_CHIP} inline-flex items-center gap-1 py-0.5 cursor-pointer hover:bg-gold-100 dark:hover:bg-gold-400/20 disabled:opacity-50`;

/** A button per field, inserting it as a chip where the cursor is in `editor`. */
export function PlaceholderButtons({ placeholders, editor, disabled, label = 'Placeholders' }: {
  placeholders: readonly LetterPlaceholder[];
  editor: React.RefObject<LetterEditorHandle | null>;
  disabled: boolean;
  label?: string;
}) {
  return (
    <div>
      <p className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {placeholders.map((p) => (
          <button key={p.key} type="button" title={`Insert ${p.meaning}`} disabled={disabled}
            onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current?.insertPlaceholder(p.key)} className={PLACEHOLDER_BUTTON}>
            <Plus className="w-3 h-3" />
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Tool({ active, disabled, onClick, title, children }: { active: boolean; disabled: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors cursor-pointer disabled:opacity-50 ${
        active
          ? 'bg-navy-100 text-navy-800 dark:bg-gold-400/15 dark:text-gold-300'
          : 'text-stone-500 dark:text-stone-400 hover:bg-stone-200/70 dark:hover:bg-white/10 hover:text-stone-800 dark:hover:text-stone-100'
      }`}
    >
      {children}
    </button>
  );
}
