'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Quote, Undo2, Redo2,
  Link as LinkIcon, Link2Off,
} from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react';

export interface EmailBodyEditorHandle {
  /** Insert text at the current cursor position (or replace selection). */
  insertText: (text: string) => void;
  /** Set the entire body content programmatically (e.g. when applying a preset). */
  setContent: (html: string) => void;
  /** Move focus into the editor. */
  focus: () => void;
}

interface Props {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * WYSIWYG editor for email bodies. Outputs an HTML string compatible with the
 * existing /api/email/messages payload (which forwards `bodyHtml` to Microsoft
 * Graph as contentType: 'HTML').
 *
 * Kept deliberately leaner than ResourceEditor — no headings or alignment —
 * because formal email bodies rarely need them and clients render them
 * inconsistently. Bold/italic/underline/list/quote/link covers the
 * 95% case.
 */
const EmailBodyEditor = forwardRef<EmailBodyEditorHandle, Props>((
  { content, onChange, placeholder, autoFocus },
  ref,
) => {
  const contentRef = useRef(content);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Compose your message...' }),
    ],
    content,
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      contentRef.current = html;
      onChange(html);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm prose-stone dark:prose-invert max-w-none min-h-[180px] max-h-[400px] overflow-y-auto outline-none px-3 py-2.5 text-sm text-stone-800 dark:text-stone-200',
      },
    },
  });

  // If content prop changes externally (e.g. signature loads, template applied,
  // reply opens with quoted body) and differs from our last emit, sync it in.
  useEffect(() => {
    if (!editor) return;
    if (content === contentRef.current) return;
    contentRef.current = content;
    // Don't dispatch onUpdate while we're rehydrating from prop.
    editor.commands.setContent(content || '', { emitUpdate: false });
  }, [editor, content]);

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end');
  }, [autoFocus, editor]);

  useImperativeHandle(ref, () => ({
    insertText: (text: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(text).run();
    },
    setContent: (html: string) => {
      if (!editor) return;
      contentRef.current = html;
      editor.commands.setContent(html || '', { emitUpdate: false });
    },
    focus: () => {
      editor?.commands.focus('end');
    },
  }), [editor]);

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
    <div className="border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden bg-stone-50/80 dark:bg-stone-800/50 focus-within:ring-2 focus-within:ring-indigo-400/20 focus-within:border-indigo-400 dark:focus-within:border-indigo-500 transition-all">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1 border-b border-stone-200 dark:border-stone-700 bg-white/60 dark:bg-stone-900/40">
        <Group>
          <Btn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (⌘B)">
            <Bold className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (⌘I)">
            <Italic className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (⌘U)">
            <UnderlineIcon className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
            <Strikethrough className="w-3.5 h-3.5" />
          </Btn>
        </Group>

        <Divider />

        <Group>
          <Btn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">
            <List className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List">
            <ListOrdered className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
            <Quote className="w-3.5 h-3.5" />
          </Btn>
        </Group>

        <Divider />

        <Group>
          <Btn active={editor.isActive('link')} onClick={setLink} title="Add Link">
            <LinkIcon className="w-3.5 h-3.5" />
          </Btn>
          {editor.isActive('link') && (
            <Btn active={false} onClick={() => editor.chain().focus().unsetLink().run()} title="Remove Link">
              <Link2Off className="w-3.5 h-3.5" />
            </Btn>
          )}
        </Group>

        <div className="ml-auto flex items-center gap-0.5">
          <Btn active={false} onClick={() => editor.chain().focus().undo().run()} title="Undo (⌘Z)">
            <Undo2 className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={false} onClick={() => editor.chain().focus().redo().run()} title="Redo (⌘⇧Z)">
            <Redo2 className="w-3.5 h-3.5" />
          </Btn>
        </div>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
});

export default EmailBodyEditor;

function Btn({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors cursor-pointer ${
        active
          ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
          : 'text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 hover:text-stone-700 dark:hover:text-stone-200'
      }`}
    >
      {children}
    </button>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return <div className="w-px h-4 bg-stone-200 dark:bg-stone-700 mx-1" />;
}
