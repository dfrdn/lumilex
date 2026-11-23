'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Paperclip, X } from 'lucide-react';
import { manilaToday } from '@/lib/dates';
import DatePickerInput from '@/components/DatePickerInput';
import { useFileDrop } from '@/hooks/use-file-drop';
import { BTN_OUTLINE, BTN_PRIMARY } from './tone';

export interface DateField {
  key: string;
  label: string;
  hint?: string;
  /** Starting value; today when omitted. */
  initial?: string | null;
  /** May be left empty. */
  optional?: boolean;
  /** A date still to come, such as a deadline someone set — exempt from the no-future-dates check. */
  allowFuture?: boolean;
  placeholder?: string;
  /** Offer to leave the date blank as not yet confirmed, under this label. */
  unconfirmable?: string;
}

/** A pick between a few options, shown as a segmented control above the dates. */
export interface ChoiceField {
  key: string;
  options: { value: string; label: string }[];
  initial: string;
}

/** A short line of text, e.g. what IPOPHL called the document. */
export interface TextField {
  key: string;
  label: string;
  placeholder?: string;
}

/** What the prompt gathered besides its dates. */
export interface PromptExtras {
  choice?: string;
  text?: string;
  file?: File;
  /** The date fields left blank as not yet confirmed. */
  unconfirmed: string[];
}

const POPOVER_WIDTH = 304;

/**
 * A button that records a step. When the step has dates it asks for them
 * first — today by default, since that's usually right, but the event may
 * have happened days ago — and refuses a day in the future. The prompt is
 * portalled so it isn't clipped by the card or list it sits in.
 *
 * It can also ask for a choice, a line of text, and the paper that came with
 * the step (`fileLabel`) — picked or dropped anywhere on the prompt, and
 * handed to `onRun` alongside the dates.
 *
 * `onRun` resolves true when the step was recorded; on false the prompt stays
 * open (the caller has said why).
 */
export default function DatedActionButton({
  label,
  fields = [],
  choice,
  text,
  fileLabel,
  onRun,
  primary,
  size = 'md',
}: {
  label: string;
  fields?: DateField[];
  choice?: ChoiceField;
  text?: TextField;
  /** Offer to attach the paper that came with the step, under this label. */
  fileLabel?: string;
  onRun: (dates: Record<string, string | null>, extras: PromptExtras) => Promise<boolean>;
  primary?: boolean;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string | null>>({});
  const [picked, setPicked] = useState<string | undefined>(choice?.initial);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [unsure, setUnsure] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const asks = fields.length > 0 || !!choice || !!text || !!fileLabel;
  const { isOver, dropProps } = useFileDrop((files) => setFile(files[0]), { disabled: !fileLabel || busy });

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8));
      // Below the button unless the room is above; either way it scrolls rather than running off the screen.
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      setPos(below >= 360 || below >= above
        ? { top: r.bottom + 8, left, maxHeight: below }
        : { bottom: window.innerHeight - r.top + 8, left, maxHeight: above });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function run(dates: Record<string, string | null>) {
    setBusy(true);
    const unconfirmed = fields.filter((f) => f.unconfirmable && unsure[f.key]).map((f) => f.key);
    const sent = { ...dates, ...Object.fromEntries(unconfirmed.map((k) => [k, null])) };
    const ok = await onRun(sent, { choice: picked, text: note.trim() || undefined, file: file ?? undefined, unconfirmed });
    setBusy(false);
    if (ok) setOpen(false);
  }

  function start() {
    if (!asks) {
      void run({});
      return;
    }
    const today = manilaToday();
    setValues(Object.fromEntries(fields.map((f) => [f.key, f.initial !== undefined ? f.initial : today])));
    setUnsure({});
    setPicked(choice?.initial);
    setNote('');
    setFile(null);
    setOpen(true);
  }

  const today = manilaToday();
  const future = fields.some((f) => !f.allowFuture && !unsure[f.key] && !!values[f.key] && values[f.key]! > today);
  const missing = fields.some((f) => !f.optional && !(f.unconfirmable && unsure[f.key]) && !values[f.key]);
  const pad = size === 'sm' ? 'px-2.5 py-1.5' : 'px-3 py-2';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : start())}
        disabled={busy && !open}
        aria-expanded={asks ? open : undefined}
        aria-haspopup={asks ? 'dialog' : undefined}
        className={`${primary ? BTN_PRIMARY : BTN_OUTLINE} ${pad} cursor-pointer`}
      >
        {busy && !open && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {label}
        {asks && <ChevronDown className={`w-3 h-3 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            role="dialog"
            aria-label={label}
            {...dropProps}
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: POPOVER_WIDTH, maxHeight: pos.maxHeight }}
            className="reveal fixed z-[60] overflow-y-auto overscroll-contain rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card shadow-[var(--shadow-elevated)] p-4 space-y-3 text-left"
          >
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-50">{label}</p>
            {choice && (
              <div role="radiogroup" className="flex rounded-lg bg-stone-100 dark:bg-white/[0.06] p-0.5 text-xs">
                {choice.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={picked === o.value}
                    onClick={() => setPicked(o.value)}
                    className={`flex-1 rounded-md px-2 py-1 cursor-pointer transition-colors ${
                      picked === o.value
                        ? 'bg-white dark:bg-card text-stone-900 dark:text-stone-50 shadow-sm font-medium'
                        : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            {text && (
              <div>
                <p className="text-xs text-stone-600 dark:text-stone-300 mb-1">{text.label}</p>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={text.placeholder}
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-white/10 bg-white dark:bg-transparent text-stone-800 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-navy-400/30"
                />
              </div>
            )}
            {fields.map((f) => (
              <div key={f.key}>
                <p className="text-xs text-stone-600 dark:text-stone-300 mb-1">{f.label}</p>
                {unsure[f.key] ? (
                  <p role="status" aria-label={`${f.label}: not confirmed yet`} className="w-full rounded-lg border border-dashed border-stone-300 dark:border-white/15 px-2.5 py-1.5 text-xs text-stone-500 dark:text-stone-400">
                    Not confirmed yet — add it once you know
                  </p>
                ) : (
                  <DatePickerInput
                    value={values[f.key] ?? null}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                    placeholder={f.placeholder}
                  />
                )}
                {f.unconfirmable && (
                  <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-stone-600 dark:text-stone-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!!unsure[f.key]}
                      aria-label={`${f.label}: ${f.unconfirmable}`}
                      onChange={(e) => setUnsure((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-stone-300 dark:border-stone-600 accent-navy-700 cursor-pointer"
                    />
                    {f.unconfirmable}
                  </label>
                )}
                {f.hint && <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">{f.hint}</p>}
              </div>
            ))}
            {fileLabel && (
              <div>
                <p className="text-xs text-stone-600 dark:text-stone-300 mb-1">{fileLabel}</p>
                {isOver ? (
                  <div className="w-full inline-flex items-center gap-1.5 rounded-lg border border-dashed border-navy-300 dark:border-navy-500/40 bg-navy-50 dark:bg-navy-500/10 px-2.5 py-1.5 text-xs text-navy-700 dark:text-navy-300">
                    <Paperclip className="w-3.5 h-3.5" /> Drop to attach
                  </div>
                ) : file ? (
                  <div className="flex items-center gap-2 rounded-lg border border-stone-200 dark:border-white/10 px-2.5 py-1.5 text-xs">
                    <Paperclip className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-stone-800 dark:text-stone-100">{file.name}</span>
                    <button type="button" onClick={() => setFile(null)} aria-label="Remove the file" className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="w-full inline-flex items-center gap-1.5 rounded-lg border border-dashed border-stone-300 dark:border-white/15 px-2.5 py-1.5 text-xs text-stone-500 hover:text-stone-800 hover:border-navy-300 dark:hover:border-navy-500/40 dark:text-stone-400 dark:hover:text-stone-100 cursor-pointer transition-colors"
                  >
                    <Paperclip className="w-3.5 h-3.5" /> Drop or attach the document (optional)
                  </button>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
            {future && <p className="text-xs text-rose-600 dark:text-rose-400">Pick today or an earlier date.</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100 cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => run(values)}
                disabled={missing || future || busy}
                className={`${BTN_PRIMARY} px-3 py-1.5 cursor-pointer`}
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
