'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Check, X, ChevronDown } from 'lucide-react';
import Avatar from '@/components/Avatar';

// ── Types ──────────────────────────────────────────────────────

export interface DropdownOption {
  id: string;
  label: string;
  sublabel?: string;
  initials?: string;
  avatarUrl?: string | null;
}

interface BaseCellDropdownProps {
  options: DropdownOption[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  placeholder?: string;
  /**
   * Whether the menu offers "Clear selection" and whether clicking the
   * selected option clears it. A picker whose value is never empty (which
   * document to edit) passes false.
   */
  allowClear?: boolean;
  /**
   * Floor for the menu width. The default sizing follows the anchor, which
   * suits a table cell but starves a menu hung off a small button — labels
   * and sublabels share one truncating line, so a narrow menu clips them.
   */
  minWidth?: number;
}

interface SingleSelectProps extends BaseCellDropdownProps {
  mode: 'single';
  value: string | null;
  onSelect: (id: string | null) => void;
}

interface MultiSelectProps extends BaseCellDropdownProps {
  mode: 'multi';
  value: string[];
  onSelect: (ids: string[]) => void;
}

type CellDropdownProps = SingleSelectProps | MultiSelectProps;

// ── Positioning hook ───────────────────────────────────────────

function useDropdownPosition(
  anchorRef: React.RefObject<HTMLElement | null>,
  dropdownRef: React.RefObject<HTMLDivElement | null>,
  isOpen: boolean,
  minWidth = 220,
) {
  const [position, setPosition] = useState({ top: -9999, left: -9999, width: 240 });

  useEffect(() => {
    if (!isOpen || !anchorRef.current) return;
    const anchor = anchorRef.current;
    const rect = anchor.getBoundingClientRect();
    // Never exceed the viewport — a wide floor must still fit a phone.
    const cap = Math.max(220, window.innerWidth - 16);
    const dropdownWidth = Math.min(cap, Math.max(minWidth, Math.min(rect.width + 40, 320)));
    const viewH = window.innerHeight;
    const spaceBelow = viewH - rect.bottom;
    const dropdownHeight = 280;

    setPosition({
      top: spaceBelow > dropdownHeight
        ? rect.bottom + 4
        : rect.top - dropdownHeight - 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8)),
      width: dropdownWidth,
    });
  }, [isOpen, anchorRef, minWidth]);

  return position;
}

// ── Main Component ─────────────────────────────────────────────

export default function CellDropdown(props: CellDropdownProps) {
  const { options, onClose, anchorRef, placeholder, minWidth, mode, allowClear = true } = props;
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const position = useDropdownPosition(anchorRef, dropdownRef, true, minWidth);

  // Multi mode buffers selection locally and only emits onSelect on commit
  // (Done button, click-outside). Escape cancels without committing.
  const initialMultiValue = mode === 'multi' ? props.value : [];
  const [draftIds, setDraftIds] = useState<string[]>(initialMultiValue);
  const cancelledRef = useRef(false);

  // Current selection state — multi reflects the in-flight draft
  const selectedIds = mode === 'multi'
    ? new Set(draftIds)
    : new Set(props.value ? [props.value] : []);

  // Filter options
  const filtered = search.trim()
    ? options.filter((o) => {
        const q = search.toLowerCase();
        return (
          o.label.toLowerCase().includes(q) ||
          (o.sublabel?.toLowerCase().includes(q) ?? false) ||
          (o.initials?.toLowerCase().includes(q) ?? false)
        );
      })
    : options;

  // Auto-focus search
  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  // Close on click outside — in multi mode this commits the draft
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      // The trigger that opened the menu is not "outside": its own click
      // handler decides whether to close, so the menu doesn't unmount here
      // and remount on the click that follows.
      if (anchorRef.current?.contains(target)) return;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        if (mode === 'multi' && !cancelledRef.current) {
          commitMultiAndClose();
        } else {
          onClose();
        }
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, mode, draftIds]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // Multi mode: Escape cancels (discard draft); single mode: just close
        cancelledRef.current = true;
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[highlightedIndex]) {
          handleSelect(filtered[highlightedIndex].id);
        } else if (mode === 'multi') {
          commitMultiAndClose();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, highlightedIndex, onClose, mode, draftIds],
  );

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-option]');
    const item = items[highlightedIndex];
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  // Reset highlight when search changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [search]);

  function handleSelect(id: string) {
    if (mode === 'single') {
      // Toggle: if same value, clear it (unless clearing is disallowed)
      const newVal = props.value === id && allowClear ? null : id;
      props.onSelect(newVal);
      onClose();
    } else {
      // Multi: toggle in draft only — commit happens on Done / click-outside
      setDraftIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return Array.from(next);
      });
    }
  }

  function handleClear() {
    if (mode === 'single') {
      props.onSelect(null);
      onClose();
    } else {
      // Multi: clear the draft only — commit on Done / click-outside
      setDraftIds([]);
    }
  }

  function commitMultiAndClose() {
    if (mode !== 'multi') {
      onClose();
      return;
    }
    const prev = props.value;
    const changed =
      prev.length !== draftIds.length ||
      prev.some((id, i) => id !== draftIds[i]) ||
      // order-insensitive compare as a safety net
      new Set(prev).size !== new Set([...prev, ...draftIds]).size;
    if (changed) props.onSelect(draftIds);
    onClose();
  }

  const selectedCount = selectedIds.size;

  return createPortal(
    <div
      ref={dropdownRef}
      onKeyDown={handleKeyDown}
      className="fixed z-[9999]"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
      }}
    >
      <div
        className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
        style={{
          boxShadow: '0 8px 30px -4px rgba(120,100,70,0.15), 0 4px 10px -4px rgba(120,100,70,0.08)',
        }}
      >
        {/* Search bar */}
        <div className="relative border-b border-[var(--border-color)]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={placeholder ?? 'Search...'}
            className="w-full pl-9 pr-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); searchRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-foreground cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Options list */}
        <div ref={listRef} className="max-h-[220px] overflow-y-auto overscroll-contain py-1 scroll-smooth">
          {/* Clear option */}
          {allowClear && selectedCount > 0 && !search && (
            <button
              type="button"
              onClick={handleClear}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm text-[var(--text-muted)] hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500 transition-colors cursor-pointer dark:hover:text-red-400"
            >
              <X className="w-3.5 h-3.5" />
              <span className="italic">Clear selection</span>
            </button>
          )}

          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
              No matches found
            </div>
          ) : (
            filtered.map((option, idx) => {
              const isSelected = selectedIds.has(option.id);
              const isHighlighted = idx === highlightedIndex;

              return (
                <button
                  key={option.id}
                  type="button"
                  data-option
                  onClick={() => handleSelect(option.id)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`
                    w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors cursor-pointer
                    ${isHighlighted
                      ? 'bg-gold-50 dark:bg-gold-500/8'
                      : 'hover:bg-[var(--subtle-bg)]'
                    }
                    ${isSelected ? 'text-foreground' : 'text-foreground'}
                  `}
                >
                  {/* Checkbox/radio indicator */}
                  <span
                    className={`
                      shrink-0 flex items-center justify-center rounded transition-all duration-100
                      ${mode === 'multi' ? 'w-4 h-4 rounded-[4px]' : 'w-4 h-4 rounded-full'}
                      ${isSelected
                        ? 'bg-gold-500 text-white shadow-sm'
                        : 'border border-[var(--border-hover)] bg-transparent'
                      }
                    `}
                  >
                    {isSelected && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                  </span>

                  {/* Avatar or initials badge */}
                  {option.avatarUrl ? (
                    <Avatar
                      avatarUrl={option.avatarUrl}
                      initials={option.initials ?? '??'}
                      name={option.label}
                      size={24}
                      fallbackClassName={isSelected
                        ? 'bg-navy-700 text-white dark:bg-navy-500 dark:text-navy-50'
                        : 'bg-navy-100 text-navy-600 dark:bg-navy-500/15 dark:text-navy-300'
                      }
                    />
                  ) : option.initials ? (
                    <span
                      className={`
                        inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0 transition-all
                        ${isSelected
                          ? 'bg-navy-700 text-white dark:bg-navy-500 dark:text-navy-50'
                          : 'bg-navy-100 text-navy-600 dark:bg-navy-500/15 dark:text-navy-300'
                        }
                      `}
                    >
                      {option.initials}
                    </span>
                  ) : null}

                  {/* Label + sublabel */}
                  <span className="flex-1 min-w-0 truncate">
                    <span className={`${isSelected ? 'font-medium' : ''}`}>{option.label}</span>
                    {option.sublabel && (
                      <span className="text-[var(--text-muted)] ml-1.5 text-xs">
                        {option.sublabel}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Multi-select footer */}
        {mode === 'multi' && (
          <div className="border-t border-[var(--border-color)] px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={commitMultiAndClose}
              className="text-xs font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 cursor-pointer px-2 py-0.5 rounded hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Trigger button for inline add / compact contexts ───────────

interface CellDropdownTriggerProps {
  label: string;
  hasValue: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

export function CellDropdownTrigger({ label, hasValue, onClick, className }: CellDropdownTriggerProps) {
  return (
    <button
      type="button"
      onClick={(e) => onClick(e)}
      className={`
        w-full flex items-center justify-between gap-1 text-left text-sm rounded-md border px-2 py-1 cursor-pointer transition-all duration-100
        border-[var(--border-color)] bg-background text-foreground
        hover:border-gold-300 dark:hover:border-gold-500/40
        focus:outline-none focus:ring-2 focus:ring-gold-400/30 focus:border-gold-400
        ${!hasValue ? 'text-[var(--text-muted)]' : ''}
        ${className ?? ''}
      `}
    >
      <span className="truncate">{label}</span>
      <ChevronDown className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
    </button>
  );
}
