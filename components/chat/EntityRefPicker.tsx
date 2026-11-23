'use client';

import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Search, FileText, CheckSquare, Gavel, Handshake, FolderOpen, Paperclip, X } from 'lucide-react';
import type { EntityRef, ChatEntityType } from '@/types/chat';

const TYPE_ICONS: Record<ChatEntityType, typeof FileText> = {
  deliverable: FileText,
  task: CheckSquare,
  hearing: Gavel,
  meeting: Handshake,
  filing: FolderOpen,
  file: Paperclip,
};

const TYPE_COLORS: Record<ChatEntityType, string> = {
  deliverable: 'text-purple-500 bg-purple-500/10',
  task: 'text-blue-500 bg-blue-500/10',
  hearing: 'text-emerald-500 bg-emerald-500/10 dark:text-emerald-400',
  meeting: 'text-cyan-500 bg-cyan-500/10',
  filing: 'text-amber-500 bg-amber-500/10',
  file: 'text-rose-500 bg-rose-500/10',
};

interface Props {
  matterId?: string | null;
  onSelect: (ref: EntityRef) => void;
  onClose: () => void;
  /** When provided, the picker is driven by this value and hides its own search input */
  externalQuery?: string;
}

export interface EntityRefPickerHandle {
  /** Pass a key string; returns true if consumed */
  handleKeyDown: (key: string) => boolean;
}

const EntityRefPicker = forwardRef<EntityRefPickerHandle, Props>(function EntityRefPicker(
  { matterId, onSelect, onClose, externalQuery },
  ref,
) {
  const [internalQuery, setInternalQuery] = useState('');
  const query = externalQuery !== undefined ? externalQuery : internalQuery;
  const [results, setResults] = useState<EntityRef[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);

  // Reset highlighted item when results change
  useEffect(() => { setActiveIndex(-1); }, [results]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (externalQuery === undefined) inputRef.current?.focus();
  }, [externalQuery]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({ q: query });
        if (matterId) params.set('matterId', matterId);
        const res = await fetch(`/api/chat/entities?${params}`);
        if (res.ok) {
          const { entities } = await res.json();
          setResults(entities);
        }
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query, matterId]);

  function navigate(key: string): boolean {
    if (key === 'ArrowDown') {
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      return true;
    }
    if (key === 'ArrowUp') {
      setActiveIndex((i) => Math.max(i - 1, 0));
      return true;
    }
    if (key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      onSelect(results[activeIndex]);
      return true;
    }
    if (key === 'Escape') {
      onClose();
      return true;
    }
    return false;
  }

  useImperativeHandle(ref, () => ({ handleKeyDown: navigate }));

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-card shadow-sm overflow-hidden">
      {/* Search input — hidden when driven externally via # typing */}
      {externalQuery === undefined && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={internalQuery}
            onChange={(e) => setInternalQuery(e.target.value)}
            onKeyDown={(e) => { if (navigate(e.key)) e.preventDefault(); }}
            placeholder="Search deliverables, tasks, hearings..."
            className="flex-1 text-xs bg-transparent text-foreground placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Results */}
      <div ref={listRef} className="max-h-[200px] overflow-y-auto">
        {isSearching && (
          <div className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">Searching...</div>
        )}
        {!isSearching && query && results.length === 0 && (
          <div className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">No results</div>
        )}
        {results.map((result, i) => {
          const Icon = TYPE_ICONS[result.type];
          return (
            <button
              key={`${result.type}-${result.id}`}
              onClick={() => onSelect(result)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left ${
                i === activeIndex ? 'bg-[var(--subtle-bg)]' : 'hover:bg-[var(--subtle-bg)]'
              }`}
            >
              <div className={`shrink-0 w-6 h-6 rounded flex items-center justify-center ${TYPE_COLORS[result.type]}`}>
                <Icon className="w-3 h-3" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate">{result.name}</p>
                <p className="text-[10px] text-[var(--text-muted)] capitalize">{result.type}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default EntityRefPicker;
