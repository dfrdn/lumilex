'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/**
 * Lightweight portal dropdown for in-form usage. Pattern-matches the inline
 * SearchableDropdown in components/AddTaskModal.tsx — kept here so the
 * issuances form doesn't have to inline 200 lines of dropdown plumbing.
 *
 * Honors CLAUDE.md "no native <select>" rule.
 */
export function SimpleDropdown({
  label,
  value,
  placeholder,
  options,
  onChange,
  required,
  disabled,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  options: { id: string; label: string; sublabel?: string }[];
  onChange: (id: string | null) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !dropdownRef.current?.contains(t)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel?.toLowerCase() ?? '').includes(q),
    );
  }, [options, search]);

  const display = value ? options.find((o) => o.id === value)?.label : '';

  return (
    <div>
      <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          open
            ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900'
            : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
        }`}
      >
        <span
          className={`truncate ${
            value
              ? 'text-stone-800 dark:text-stone-100'
              : 'text-stone-400 dark:text-stone-500'
          }`}
        >
          {display || placeholder || 'Select…'}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {value && !disabled && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="p-0.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 dark:hover:bg-stone-700 dark:text-stone-500"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-stone-400 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg overflow-hidden dark:bg-stone-900 dark:border-stone-700"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            <div className="p-2 border-b border-stone-100 dark:border-stone-800">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-stone-50 rounded-md dark:bg-stone-800">
                <Search className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto py-0.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-sm text-stone-400 text-center dark:text-stone-500">
                  No results
                </p>
              ) : (
                filtered.map((opt) => {
                  const sel = opt.id === value;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        onChange(opt.id);
                        setOpen(false);
                        setSearch('');
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left cursor-pointer transition-colors ${
                        sel
                          ? 'text-gold-700 bg-gold-50/80 dark:bg-gold-500/10 dark:text-gold-300'
                          : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'
                      }`}
                    >
                      <div className="min-w-0">
                        <span className={`truncate ${sel ? 'font-medium' : ''}`}>
                          {opt.label}
                        </span>
                        {opt.sublabel && (
                          <span
                            className={`text-xs ml-1.5 ${
                              sel
                                ? 'text-gold-500 dark:text-gold-400'
                                : 'text-stone-400 dark:text-stone-500'
                            }`}
                          >
                            {opt.sublabel}
                          </span>
                        )}
                      </div>
                      {sel && (
                        <Check className="w-3.5 h-3.5 text-gold-600 shrink-0 dark:text-gold-400" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Multi-select chip variant — for practice_areas + tags. */
export function SimpleMultiDropdown({
  label,
  values,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  placeholder?: string;
  options: { id: string; label: string }[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !dropdownRef.current?.contains(t)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  const selectedSet = useMemo(() => new Set(values), [values]);
  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  function toggle(id: string) {
    if (selectedSet.has(id)) onChange(values.filter((v) => v !== id));
    else onChange([...values, id]);
  }

  return (
    <div>
      <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
        {label}
      </label>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {values.map((v) => {
            const opt = options.find((o) => o.id === v);
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs font-medium bg-stone-100 border border-stone-200 text-stone-700 rounded-full dark:bg-stone-800 dark:border-stone-700 dark:text-stone-200"
              >
                {opt?.label ?? v}
                <button
                  type="button"
                  onClick={() => toggle(v)}
                  className="p-0.5 rounded-full text-stone-400 hover:text-rose-500 hover:bg-rose-50 dark:text-stone-500 dark:hover:bg-rose-500/10"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border transition-colors cursor-pointer ${
          open
            ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900'
            : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
        }`}
      >
        <span className="truncate text-stone-400 dark:text-stone-500">
          {values.length > 0 ? 'Add more…' : placeholder || 'Select…'}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg overflow-hidden dark:bg-stone-900 dark:border-stone-700"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            <div className="p-2 border-b border-stone-100 dark:border-stone-800">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full px-2.5 py-1.5 text-sm bg-stone-50 rounded-md outline-none dark:bg-stone-800 dark:text-stone-100"
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-0.5">
              {filtered.map((opt) => {
                const sel = selectedSet.has(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggle(opt.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left cursor-pointer transition-colors ${
                      sel
                        ? 'text-gold-700 bg-gold-50/80 dark:bg-gold-500/10 dark:text-gold-300'
                        : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'
                    }`}
                  >
                    <span className={`truncate ${sel ? 'font-medium' : ''}`}>{opt.label}</span>
                    {sel && <Check className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
