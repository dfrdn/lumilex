'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X, Check } from 'lucide-react';

interface Props {
  clients: string[];
  value: string;
  onChange: (value: string) => void;
  /** What the footer counts; the default suits the billing pickers it was built for. */
  countNoun?: string;
}

export default function ClientCombobox({ clients, value, onChange, countNoun = 'unbilled client' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query) return clients;
    const q = query.toLowerCase();
    return clients.filter((c) => c.toLowerCase().includes(q));
  }, [clients, query]);

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[activeIndex] as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function handleOpen() {
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function select(client: string) {
    onChange(client);
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIndex]) select(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-xl bg-[var(--background)] border border-[var(--border-color)] text-foreground hover:border-gold-400/50 focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 transition-colors cursor-pointer"
      >
        <span className={value ? 'text-foreground' : 'text-[var(--text-muted)]'}>
          {value || 'Select a client...'}
        </span>
        <div className="flex items-center gap-1">
          {value && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="p-0.5 rounded hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] z-50 overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search clients..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-[var(--text-muted)] outline-none min-w-0"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Options list */}
          <div ref={listRef} className="max-h-[240px] overflow-y-auto overscroll-contain py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                No clients found
              </div>
            ) : (
              filtered.map((client, i) => (
                <button
                  key={client}
                  type="button"
                  onClick={() => select(client)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer ${
                    i === activeIndex
                      ? 'bg-[var(--subtle-bg)] text-foreground'
                      : 'text-[var(--text-secondary)] hover:text-foreground'
                  }`}
                >
                  <Check className={`w-3.5 h-3.5 shrink-0 ${client === value ? 'text-gold-500 dark:text-gold-400' : 'invisible'}`} />
                  <span className="truncate">{client}</span>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-t border-[var(--border-color)] bg-[var(--subtle-bg)]">
            <span className="text-[10px] text-[var(--text-muted)]">{filtered.length} {countNoun}{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}
