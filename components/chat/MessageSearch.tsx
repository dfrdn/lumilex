'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import type { ChatMessage } from '@/types/chat';

interface SearchResult extends ChatMessage {
  channel_name?: string;
}

interface Props {
  channelId: string;
  onClose: () => void;
  onJumpToMessage?: (messageId: string) => void;
}

export default function MessageSearch({ channelId, onClose, onJumpToMessage }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      fetch(`/api/chat/search?q=${encodeURIComponent(q)}&channelId=${channelId}`)
        .then((r) => r.json())
        .then((data) => {
          setResults(data.results ?? []);
          setActiveIndex(0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [channelId],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const navigateResult = (direction: 'up' | 'down') => {
    if (results.length === 0) return;
    const next =
      direction === 'down'
        ? (activeIndex + 1) % results.length
        : (activeIndex - 1 + results.length) % results.length;
    setActiveIndex(next);
    onJumpToMessage?.(results[next].id);
  };

  useEffect(() => {
    if (results.length > 0 && results[activeIndex]) {
      onJumpToMessage?.(results[activeIndex].id);
    }
  }, [activeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-card">
      <Search className="shrink-0 w-3.5 h-3.5 text-[var(--text-muted)]" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            navigateResult(e.shiftKey ? 'up' : 'down');
          }
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Search messages..."
        className="flex-1 text-xs bg-transparent text-foreground placeholder:text-[var(--text-muted)] focus:outline-none"
      />
      {loading && <Loader2 className="shrink-0 w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />}
      {results.length > 0 && (
        <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
          {activeIndex + 1}/{results.length}
        </span>
      )}
      {results.length > 0 && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => navigateResult('up')}
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-foreground transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => navigateResult('down')}
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-foreground transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <button
        onClick={onClose}
        className="shrink-0 p-1 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
