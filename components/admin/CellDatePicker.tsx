'use client';

import { useState, useRef, useEffect, useCallback, useMemo, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, Calendar } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

interface CellDatePickerProps {
  value: string | null;
  onSelect: (date: string | null) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** When true, show time inputs (hour/minute) below the calendar */
  showTime?: boolean;
  /** When true, also show an "End" time row for editing a time range on the
   *  same day. Requires `showTime`. When set, `onSelectRange` is called on
   *  confirm (instead of `onSelect`) with both start and end ISO strings. */
  showEndTime?: boolean;
  /** Initial end-time value for the End row (ISO string). Only used when
   *  `showEndTime` is true. */
  endValue?: string | null;
  /** Invoked on confirm when `showEndTime` is true. Overrides `onSelect`. */
  onSelectRange?: (range: { start: string | null; end: string | null }) => void;
}

// ── Helpers ─────────────────────────────────────────────────────

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDateTimeStr(d: Date, hour: number, minute: number): string {
  const dateStr = toDateStr(d);
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  // Include local timezone offset so Supabase stores the correct UTC equivalent
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const oh = String(Math.floor(absMin / 60)).padStart(2, '0');
  const om = String(absMin % 60).padStart(2, '0');
  return `${dateStr}T${timeStr}${sign}${oh}:${om}`;
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  // Try parsing as-is first (handles ISO with time), then fall back to date-only
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return isNaN(d.getTime()) ? null : d;
}

function parseTime(s: string | null): { hour: number; minute: number } {
  if (!s || s.length <= 10) return { hour: 9, minute: 0 };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { hour: 9, minute: 0 };
  return { hour: d.getHours(), minute: d.getMinutes() };
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── Positioning ─────────────────────────────────────────────────

function usePickerPosition(anchorRef: React.RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState({ top: -9999, left: -9999 });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const pickerW = 280;
    const pickerH = 340;
    const viewH = window.innerHeight;
    const spaceBelow = viewH - rect.bottom;

    setPosition({
      top: spaceBelow > pickerH ? rect.bottom + 4 : rect.top - pickerH - 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - pickerW - 8)),
    });
  }, [anchorRef]);

  return position;
}

// ── Component ───────────────────────────────────────────────────

export default function CellDatePicker({
  value,
  onSelect,
  onClose,
  anchorRef,
  showTime,
  showEndTime,
  endValue,
  onSelectRange,
}: CellDatePickerProps) {
  const parsed = parseDate(value);
  const initialTime = parseTime(value);
  const initialEndTime = parseTime(endValue ?? null);
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? today.getMonth());
  const [hour, setHour] = useState(initialTime.hour);
  const [minute, setMinute] = useState(initialTime.minute);
  const [endHour, setEndHour] = useState(initialEndTime.hour);
  const [endMinute, setEndMinute] = useState(initialEndTime.minute);
  const [selectedDate, setSelectedDate] = useState<Date | null>(parsed);
  const [viewMode, setViewMode] = useState<'days' | 'months' | 'years'>('days');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const position = usePickerPosition(anchorRef);

  // Close on click outside. Capture phase so a modal wrapper's
  // stopPropagation can't swallow the event. The trigger button is marked
  // with data-datepicker-trigger so a click on it doesn't immediately
  // close-then-reopen (mousedown fires before the button's onClick).
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      // Clicks on the same trigger that opened this picker should be
      // handled by the trigger button itself, not by closing here.
      if (target.closest('[data-datepicker-trigger]') === anchorRef.current) {
        return;
      }
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [onClose, anchorRef]);

  // Keyboard
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (viewMode === 'years') setViewMode('months');
      else if (viewMode === 'months') setViewMode('days');
      else onClose();
    }
  }, [onClose, viewMode]);

  // Navigation
  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { date: Date; isCurrentMonth: boolean }[] = [];

  // Previous month trailing days
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({
      date: new Date(viewYear, viewMonth - 1, prevMonthDays - i),
      isCurrentMonth: false,
    });
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: new Date(viewYear, viewMonth, d),
      isCurrentMonth: true,
    });
  }
  // Next month leading days
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({
      date: new Date(viewYear, viewMonth + 1, d),
      isCurrentMonth: false,
    });
  }

  // Only show 5 rows if last row is all next month
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  // Trim trailing row if all days are next month
  if (rows.length === 6 && rows[5].every((c) => !c.isCurrentMonth)) {
    rows.pop();
  }

  function selectDate(d: Date) {
    if (showTime) {
      // In datetime mode, clicking a date selects it but doesn't close — user needs to confirm
      setSelectedDate(d);
    } else {
      onSelect(toDateStr(d));
      onClose();
    }
  }

  function confirmDateTime() {
    if (selectedDate) {
      if (showEndTime && onSelectRange) {
        onSelectRange({
          start: toDateTimeStr(selectedDate, hour, minute),
          end: toDateTimeStr(selectedDate, endHour, endMinute),
        });
      } else {
        onSelect(toDateTimeStr(selectedDate, hour, minute));
      }
    }
    onClose();
  }

  function handleClear() {
    if (showEndTime && onSelectRange) {
      onSelectRange({ start: null, end: null });
    } else {
      onSelect(null);
    }
    onClose();
  }

  return createPortal(
    <div
      ref={dropdownRef}
      onKeyDown={handleKeyDown}
      className="fixed z-[9999]"
      // Marker so parent popovers (e.g. ReviewDatesDropdown) that listen
      // for outside-click don't treat calendar clicks as "outside" — since
      // this picker lives in a document.body portal, it's not a DOM
      // descendant of its host popover.
      data-cell-datepicker-portal="true"
      style={{ top: position.top, left: position.left, width: 280 }}
    >
      <div
        className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
        style={{
          boxShadow: '0 8px 30px -4px rgba(120,100,70,0.15), 0 4px 10px -4px rgba(120,100,70,0.08)',
        }}
      >
        {/* Header — month/year nav */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <button
            type="button"
            onClick={() => {
              if (viewMode === 'days') prevMonth();
              else if (viewMode === 'months') setViewYear((y) => y - 1);
              else setViewYear((y) => y - 12);
            }}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1">
            {viewMode === 'years' ? (
              <span className="text-sm font-semibold text-foreground">
                {viewYear - 5}&ndash;{viewYear + 6}
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setViewMode(viewMode === 'months' ? 'days' : 'months')}
                  className="text-sm font-semibold text-foreground hover:text-gold-600 dark:hover:text-gold-400 transition-colors cursor-pointer"
                >
                  {viewMode === 'months' ? viewYear : MONTHS[viewMonth]}
                </button>
                {viewMode === 'days' && (
                  <button
                    type="button"
                    onClick={() => setViewMode('years')}
                    className="text-sm font-semibold text-foreground hover:text-gold-600 dark:hover:text-gold-400 transition-colors cursor-pointer"
                  >
                    {viewYear}
                  </button>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (viewMode === 'days') nextMonth();
              else if (viewMode === 'months') setViewYear((y) => y + 1);
              else setViewYear((y) => y + 12);
            }}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Months grid */}
        {viewMode === 'months' && (
          <div className="grid grid-cols-3 gap-1 px-3 pb-3">
            {MONTHS_SHORT.map((m, i) => {
              const isCurrentMonth = i === today.getMonth() && viewYear === today.getFullYear();
              const isSelected = i === viewMonth && viewYear === (parsed?.getFullYear() ?? today.getFullYear());
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setViewMonth(i); setViewMode('days'); }}
                  className={`px-2 py-2 text-sm rounded-lg transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-gold-500 text-white font-semibold shadow-sm'
                      : isCurrentMonth
                        ? 'font-semibold ring-1 ring-gold-400/50 text-foreground'
                        : 'text-foreground hover:bg-[var(--subtle-bg)]'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        )}

        {/* Years grid */}
        {viewMode === 'years' && (
          <div className="grid grid-cols-3 gap-1 px-3 pb-3">
            {Array.from({ length: 12 }, (_, i) => viewYear - 5 + i).map((y) => {
              const isCurrentYear = y === today.getFullYear();
              const isSelected = y === viewYear && viewMode === 'years';
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => { setViewYear(y); setViewMode('months'); }}
                  className={`px-2 py-2 text-sm rounded-lg transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-gold-500 text-white font-semibold shadow-sm'
                      : isCurrentYear
                        ? 'font-semibold ring-1 ring-gold-400/50 text-foreground'
                        : 'text-foreground hover:bg-[var(--subtle-bg)]'
                  }`}
                >
                  {y}
                </button>
              );
            })}
          </div>
        )}

        {/* Day labels */}
        {viewMode === 'days' && (
          <div className="grid grid-cols-7 px-2">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] py-1">
                {d}
              </div>
            ))}
          </div>
        )}

        {/* Calendar grid */}
        {viewMode === 'days' && (
          <div className="px-2 pb-2">
            {rows.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((cell, ci) => {
                  const isToday = isSameDay(cell.date, today);
                  const activeSelection = showTime ? selectedDate : parsed;
                  const isSelected = activeSelection && isSameDay(cell.date, activeSelection);

                  return (
                    <button
                      key={ci}
                      type="button"
                      onClick={() => selectDate(cell.date)}
                      className={`
                        relative w-full aspect-square flex items-center justify-center text-sm rounded-lg transition-all duration-100 cursor-pointer
                        ${!cell.isCurrentMonth ? 'text-[var(--text-muted)]/40' : 'text-foreground'}
                        ${isSelected
                          ? 'bg-gold-500 text-white font-semibold shadow-sm'
                          : isToday
                            ? 'font-semibold ring-1 ring-gold-400/50'
                            : 'hover:bg-[var(--subtle-bg)]'
                        }
                      `}
                    >
                      {cell.date.getDate()}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Time picker (datetime mode only) — 12-hour format */}
        {viewMode === 'days' && showTime && (
          <div className="border-t border-[var(--border-color)] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--text-muted)] shrink-0">Time</span>
              <select
                value={hour % 12 || 12}
                onChange={(e) => {
                  const h12 = Number(e.target.value);
                  const isPM = hour >= 12;
                  setHour(h12 === 12 ? (isPM ? 12 : 0) : (isPM ? h12 + 12 : h12));
                }}
                className="flex-1 text-sm rounded-md border border-[var(--border-color)] bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const v = i === 0 ? 12 : i;
                  return (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  );
                })}
              </select>
              <span className="text-sm font-medium text-[var(--text-muted)]">:</span>
              <select
                value={minute}
                onChange={(e) => setMinute(Number(e.target.value))}
                className="flex-1 text-sm rounded-md border border-[var(--border-color)] bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <select
                value={hour >= 12 ? 'PM' : 'AM'}
                onChange={(e) => {
                  const isPM = e.target.value === 'PM';
                  const h12 = hour % 12;
                  setHour(isPM ? h12 + 12 : h12);
                }}
                className="text-sm rounded-md border border-[var(--border-color)] bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
            {showEndTime && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs font-medium text-[var(--text-muted)] shrink-0">End&nbsp;</span>
                <select
                  value={endHour % 12 || 12}
                  onChange={(e) => {
                    const h12 = Number(e.target.value);
                    const isPM = endHour >= 12;
                    setEndHour(h12 === 12 ? (isPM ? 12 : 0) : (isPM ? h12 + 12 : h12));
                  }}
                  className="flex-1 text-sm rounded-md border border-[var(--border-color)] bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
                >
                  {Array.from({ length: 12 }, (_, i) => {
                    const v = i === 0 ? 12 : i;
                    return (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    );
                  })}
                </select>
                <span className="text-sm font-medium text-[var(--text-muted)]">:</span>
                <select
                  value={endMinute}
                  onChange={(e) => setEndMinute(Number(e.target.value))}
                  className="flex-1 text-sm rounded-md border border-[var(--border-color)] bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
                >
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, '0')}
                    </option>
                  ))}
                </select>
                <select
                  value={endHour >= 12 ? 'PM' : 'AM'}
                  onChange={(e) => {
                    const isPM = e.target.value === 'PM';
                    const h12 = endHour % 12;
                    setEndHour(isPM ? h12 + 12 : h12);
                  }}
                  className="text-sm rounded-md border border-[var(--border-color)] bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {viewMode === 'days' && <div className="border-t border-[var(--border-color)] px-3 py-2 flex items-center justify-between">
          {showTime ? (
            <>
              <button
                type="button"
                onClick={handleClear}
                className="text-xs font-medium text-[var(--text-muted)] hover:text-red-500 cursor-pointer px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors flex items-center gap-1 dark:hover:text-red-400"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
              <button
                type="button"
                onClick={confirmDateTime}
                disabled={!selectedDate}
                className="text-xs font-semibold text-white bg-gold-500 hover:bg-gold-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer px-3 py-1 rounded-md transition-colors"
              >
                Set
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { selectDate(today); }}
                className="text-xs font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 cursor-pointer px-2 py-0.5 rounded hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-colors"
              >
                Today
              </button>
              {parsed && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs font-medium text-[var(--text-muted)] hover:text-red-500 cursor-pointer px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors flex items-center gap-1 dark:hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </>
          )}
        </div>}
      </div>
    </div>,
    document.body,
  );
}

// ── Trigger ─────────────────────────────────────────────────────

/**
 * Where the trigger sits, so it matches the fields beside it:
 * - `cell`: an admin grid cell or an inline table edit
 * - `form`: a dialog of stone fields (the add dialogs)
 * - `filter`: the stone look at a filter bar's size
 * - `token`: a panel whose fields use the theme tokens (text-sm)
 * - `compact`: the token look at the finance dialogs' text-xs size
 * - `client`: the client-ui kit (portal, public intake)
 */
export type DateTriggerVariant = 'cell' | 'form' | 'filter' | 'token' | 'compact' | 'client';

interface CellDateTriggerProps {
  value: string | null;
  placeholder?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  /** Show time alongside date */
  showTime?: boolean;
  variant?: DateTriggerVariant;
  /** The calendar is open (every variant but cell) */
  active?: boolean;
  /** Validation error border (every variant but cell) */
  hasError?: boolean;
}

const CELL_TRIGGER = 'gap-1 text-sm rounded-md px-2 py-1 transition-all duration-100 border-[var(--border-color)] bg-background hover:border-gold-300 dark:hover:border-gold-500/40 focus:ring-2 focus:ring-gold-400/30 focus:border-gold-400';

type Tone = 'stone' | 'token' | 'client';

const FIELD: Record<Exclude<DateTriggerVariant, 'cell'>, { size: string; icon: string; tone: Tone }> = {
  form: { size: 'gap-1 px-3 py-2 text-sm rounded-lg', icon: 'w-3.5 h-3.5', tone: 'stone' },
  filter: { size: 'gap-1 px-2.5 py-1.5 text-xs rounded-lg', icon: 'w-3 h-3', tone: 'stone' },
  token: { size: 'gap-1 px-3 py-2 text-sm rounded-lg', icon: 'w-3.5 h-3.5', tone: 'token' },
  compact: { size: 'gap-1 px-3 py-1.5 text-xs rounded-lg', icon: 'w-3 h-3', tone: 'token' },
  client: { size: 'gap-1 px-3 py-2 text-sm rounded-xl', icon: 'w-3.5 h-3.5', tone: 'client' },
};

const ERROR_TONE = 'border-red-400 ring-1 ring-red-400/20 bg-red-50/20 dark:border-red-500/70 dark:bg-red-950/10 focus:ring-2';

const TONE: Record<Tone, { idle: string; active: string; value: string; empty: string; icon: string }> = {
  stone: {
    idle: 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600 focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 dark:focus:border-gold-400',
    active: 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900 dark:border-gold-400',
    value: 'text-stone-800 dark:text-stone-100',
    empty: 'text-stone-400 dark:text-stone-500',
    icon: 'text-stone-400 dark:text-stone-500',
  },
  token: {
    idle: 'border-[var(--border-color)] bg-[var(--background)] hover:border-[var(--border-hover)] focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20',
    active: 'border-gold-400 ring-2 ring-gold-400/20 bg-[var(--background)]',
    value: 'text-foreground',
    empty: 'text-[var(--text-muted)]',
    icon: 'text-[var(--text-muted)]',
  },
  client: {
    idle: 'border-[var(--border-color)] bg-card hover:border-[var(--border-hover)] focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20',
    active: 'border-gold-400 ring-2 ring-gold-400/20 bg-card',
    value: 'text-foreground',
    empty: 'text-[var(--text-muted)]',
    icon: 'text-[var(--text-muted)]',
  },
};

export const CellDateTrigger = forwardRef<HTMLButtonElement, CellDateTriggerProps>(
  function CellDateTrigger(
    { value, placeholder, onClick, className, showTime, variant = 'cell', active = false, hasError = false },
    ref,
  ) {
    let display: string | null = null;
    if (value) {
      if (showTime && value.length > 10) {
        const d = new Date(value);
        display = isNaN(d.getTime())
          ? value
          : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
            ' ' +
            d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true });
      } else {
        display = new Date(value.length === 10 ? value + 'T00:00:00' : value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }

    let look: string;
    let icon: string;
    if (variant === 'cell') {
      look = `${CELL_TRIGGER} text-foreground ${value ? '' : 'text-[var(--text-muted)]'}`;
      icon = 'w-3 h-3 text-[var(--text-muted)]';
    } else {
      const field = FIELD[variant];
      const tone = TONE[field.tone];
      const state = hasError ? ERROR_TONE : active ? tone.active : tone.idle;
      look = `${field.size} transition-all duration-150 ${state} ${value ? tone.value : tone.empty}`;
      icon = `${field.icon} ${tone.icon}`;
    }

    return (
      <button
        ref={ref}
        type="button"
        data-datepicker-trigger
        onClick={onClick}
        className={`w-full flex items-center justify-between text-left border cursor-pointer focus:outline-none ${look} ${className ?? ''}`}
      >
        <span className="truncate">{display ?? placeholder ?? 'Select date'}</span>
        <Calendar className={`${icon} shrink-0`} />
      </button>
    );
  },
);
