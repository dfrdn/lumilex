'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export interface SearchableOption {
  id: string;
  label: string;
  sublabel?: string | null;
  /** Extra text matched on search but not displayed (e.g. an alternate name). */
  keywords?: string | null;
}

interface Props {
  options: SearchableOption[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Max options rendered in the list (the rest are reachable via search). */
  limit?: number;
}

/**
 * Reusable searchable single-select: closes on outside click and Escape,
 * supports arrow-key navigation + Enter, and filters as you type. Replaces
 * the various hand-rolled comboboxes that lacked outside-click/keyboard.
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  limit = 50,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;
  const filtered = query.trim()
    ? options.filter((o) => `${o.label} ${o.sublabel ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    : options;
  const shown = filtered.slice(0, limit);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.1)] bg-card text-sm hover:border-stone-300 dark:hover:border-white/20"
      >
        <span className={selected ? '' : 'text-stone-400'}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.1)] bg-card shadow-lg max-h-72 overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-100 dark:border-[rgba(255,255,255,0.06)]">
            <Search className="w-3.5 h-3.5 text-stone-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIdx((i) => Math.min(i + 1, shown.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (shown[activeIdx]) choose(shown[activeIdx].id);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
              placeholder={searchPlaceholder}
              className="bg-transparent text-sm focus:outline-none flex-1"
            />
          </div>
          <div className="overflow-y-auto">
            {shown.map((o, i) => (
              <button
                key={o.id}
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => choose(o.id)}
                className={`w-full text-left px-3 py-2 text-sm ${
                  i === activeIdx ? 'bg-stone-50 dark:bg-white/5' : ''
                }`}
              >
                <span className="font-medium">{o.label}</span>
                {o.sublabel && <span className="text-xs text-stone-400 ml-2">{o.sublabel}</span>}
              </button>
            ))}
            {shown.length === 0 && <p className="px-3 py-3 text-xs text-stone-400">No matches.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
