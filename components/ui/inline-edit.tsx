'use client';

import { useRef, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import CellDatePicker from '@/components/admin/CellDatePicker';
import { formatDate } from '@/lib/format-date';

/**
 * Fields that look like text until clicked. Each saves itself and, when the
 * save fails (`onSave` resolves false), puts the old value back — the caller
 * shows why.
 */

const FOCUS = 'focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-400/20 dark:focus:border-navy-300 dark:focus:ring-navy-300/20';

/** One line of text. Saves on blur or Enter; Escape reverts. */
export function InlineText({
  value,
  onSave,
  placeholder,
  className = 'text-sm text-stone-800 dark:text-stone-100',
  mono,
  type = 'text',
  ariaLabel,
}: {
  value: string;
  onSave: (v: string) => Promise<boolean>;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  type?: 'text' | 'email';
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }

  async function commit() {
    const next = draft.trim();
    if (next === value.trim()) {
      setDraft(value);
      return;
    }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (!ok) setDraft(value);
  }

  return (
    <div className="relative">
      <input
        type={type}
        value={draft}
        title={draft || undefined}
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setTimeout(() => (e.target as HTMLInputElement).blur());
          }
        }}
        className={`w-full bg-transparent rounded-md px-1.5 py-0.5 -mx-1.5 border border-transparent hover:border-stone-200 dark:hover:border-white/10 transition-colors ${FOCUS} placeholder:text-stone-400 dark:placeholder:text-stone-500 placeholder:font-normal ${
          mono ? 'font-mono' : ''
        } ${saving ? 'pr-5' : ''} ${className}`}
      />
      {saving && <Loader2 className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-navy-500" />}
    </div>
  );
}

/** A paragraph of notes. Saves on blur. */
export function NotesField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  return (
    <label className="block">
      <span className="block mb-1.5 text-[12px] text-stone-500 dark:text-stone-400">{label}</span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          if (draft === value) return;
          if (!(await onSave(draft))) setDraft(value);
        }}
        rows={4}
        placeholder={placeholder}
        className={`w-full px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-stone-50 dark:bg-white/[0.03] border border-stone-200 dark:border-white/10 rounded-xl placeholder:text-stone-400 dark:placeholder:text-stone-500 resize-y transition-colors ${FOCUS}`}
      />
    </label>
  );
}

/**
 * A recorded date the user can correct. Shown day-month-year; click to pick
 * another day. Clearing is passed through as null — callers whose date
 * carries a status refuse it.
 */
export function EditableDate({
  value,
  onChange,
  placeholder = 'Set date',
}: {
  value: string | null;
  onChange: (v: string | null) => Promise<boolean>;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={value ? 'Change date' : undefined}
        className={`group inline-flex items-center gap-1 rounded px-1 -mx-1 whitespace-nowrap cursor-pointer transition-colors hover:bg-navy-50 dark:hover:bg-navy-500/10 ${
          value ? 'text-stone-800 dark:text-stone-100' : 'text-navy-700 dark:text-navy-300'
        }`}
      >
        <span className="text-xs tabular-nums">{value ? formatDate(value) : placeholder}</span>
        {saving ? (
          <Loader2 className="w-3 h-3 animate-spin text-navy-500" />
        ) : (
          <Pencil className="w-3 h-3 text-stone-400 opacity-40 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
      {open && (
        <CellDatePicker
          value={value}
          onSelect={async (v) => {
            setOpen(false);
            if (v === value) return;
            setSaving(true);
            try {
              await onChange(v);
            } finally {
              setSaving(false);
            }
          }}
          onClose={() => setOpen(false)}
          anchorRef={ref as React.RefObject<HTMLElement | null>}
        />
      )}
    </>
  );
}
