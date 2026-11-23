'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Pencil, Loader2, Check, X } from 'lucide-react';

interface Props {
  id: string;
  initialName: string;
  /** API endpoint accepting PATCH `{ id, name }` — e.g. /api/hearing or /api/meeting */
  endpoint: string;
  canEdit: boolean;
}

/**
 * Inline hover-to-edit title for the detail-page header. Hover shows a pencil
 * icon + subtle blue highlight, click turns the heading into an input.
 * Enter/blur saves, Esc cancels. Updates local state on success; server-rendered
 * copies of the name elsewhere (breadcrumbs, DTR prefill) stay until next nav.
 */
export default function EditableDetailTitle({ id, initialName, endpoint, canEdit }: Props) {
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [errorAt, setErrorAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === name) return;

    setSaving(true);
    setName(trimmed);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: trimmed }),
      });
      if (!res.ok) throw new Error('Failed');
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(0), 1500);
    } catch {
      setName(name);
      setDraft(name);
      setErrorAt(Date.now());
      setTimeout(() => setErrorAt(0), 1500);
    } finally {
      setSaving(false);
    }
  }, [draft, name, id, endpoint]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(name);
            setEditing(false);
          }
        }}
        className="flex-1 min-w-0 font-serif text-2xl text-stone-900 dark:text-stone-50 tracking-tight bg-white dark:bg-card border border-navy-300 dark:border-navy-400/40 rounded-md px-2 py-0.5 outline-none focus:ring-2 focus:ring-navy-400/20"
      />
    );
  }

  return (
    <div
      onClick={() => {
        if (!canEdit || saving) return;
        setDraft(name);
        setEditing(true);
      }}
      className={`relative group/title flex-1 min-w-0 rounded-md transition-all duration-200 px-2 -mx-2 py-0.5 -my-0.5 ${
        canEdit
          ? 'cursor-pointer hover:bg-stone-100/70 dark:hover:bg-white/[0.04]'
          : ''
      } ${savedAt ? 'animate-field-save' : ''} ${errorAt ? 'animate-field-error' : ''}`}
    >
      <h1 className="font-serif text-2xl text-stone-900 dark:text-stone-50 tracking-tight pr-6">
        {name}
      </h1>
      {canEdit && !saving && !savedAt && !errorAt && (
        <span className="absolute top-1/2 -translate-y-1/2 right-1.5 opacity-0 group-hover/title:opacity-100 transition-opacity">
          <Pencil className="w-3.5 h-3.5 text-stone-400" />
        </span>
      )}
      {saving && (
        <span className="absolute top-1/2 -translate-y-1/2 right-1.5">
          <Loader2 className="w-3.5 h-3.5 text-stone-400 animate-spin" />
        </span>
      )}
      {!!savedAt && (
        <span className="absolute top-1/2 -translate-y-1/2 right-1.5">
          <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
        </span>
      )}
      {!!errorAt && (
        <span className="absolute top-1/2 -translate-y-1/2 right-1.5">
          <X className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
        </span>
      )}
    </div>
  );
}
