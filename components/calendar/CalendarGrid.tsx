'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import type { FirmCalendarData } from '@/hooks/use-firm-calendar';
import type { CalendarFilterKey } from './calendar-types';
import { isDateOnly, toManilaDay } from '@/lib/dates';

interface Props {
  year: number;
  month: number;
  data: FirmCalendarData | undefined;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  enabledFilters: Set<CalendarFilterKey>;
  filterKey: string;
  showDetails?: boolean;
  onOpenEntity?: (entity: string, id: string, name: string) => void;
}

// Internal dot type → CalendarFilterKey used by the legend
const TYPE_TO_FILTER: Record<string, CalendarFilterKey> = {
  meeting: 'meeting',
  hearing: 'hearing',
  filing: 'filing',
  deliverable_deadline: 'deadline',
  deliverable_review: 'review',
  leave: 'leave',
  holiday: 'holiday',
  errand: 'errand',
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DOT_COLORS: Record<string, string> = {
  meeting: 'bg-blue-400',
  hearing: 'bg-rose-400',
  filing: 'bg-amber-500',
  deliverable_deadline: 'bg-orange-400',
  deliverable_review: 'bg-violet-400',
  leave: 'bg-cyan-400',
  holiday: 'bg-emerald-400',
  errand: 'bg-fuchsia-400',
};

const TOOLTIP_DOT: Record<string, string> = {
  meeting: 'bg-blue-400',
  hearing: 'bg-rose-400',
  filing: 'bg-amber-500',
  deliverable_deadline: 'bg-orange-400',
  deliverable_review: 'bg-violet-400',
  leave: 'bg-cyan-400',
  holiday: 'bg-emerald-400',
  errand: 'bg-fuchsia-400',
};

const TYPE_LABELS: Record<string, string> = {
  meeting: 'Meeting',
  hearing: 'Hearing',
  filing: 'Filing',
  deliverable_deadline: 'Deadline',
  deliverable_review: 'Review',
  leave: 'Leave',
  holiday: 'Holiday',
  errand: 'Errand',
};

interface DayEntry {
  type: string;
  name: string;
  id?: string;
  entity?: string; // 'deliverables' | 'meetings' | 'hearings' | 'filings'
  matter?: string;
  time?: string;
  subType?: string; // e.g. 'Initial Review', 'Final Review', 'Deadline' for deliverables
}

function getReviewLabel(reviewerIndex?: number, reviewerCount?: number): string {
  if (reviewerIndex == null || !reviewerCount || reviewerCount <= 0) return 'Review';
  if (reviewerCount === 1) return 'Review';
  if (reviewerIndex === 0) return 'Initial Review';
  if (reviewerIndex === reviewerCount - 1) return 'Final Review';
  return ['2nd', '3rd', '4th'][reviewerIndex - 1] + ' Review';
}

function pad(n: number) { return n.toString().padStart(2, '0'); }

export default function CalendarGrid({ year, month, data, selectedDate, onSelectDate, enabledFilters, filterKey, showDetails = false, onOpenEntity }: Props) {
  const isTypeEnabled = useCallback(
    (type: string) => {
      const key = TYPE_TO_FILTER[type];
      return key ? enabledFilters.has(key) : true;
    },
    [enabledFilters],
  );

  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  // Build date → entity types map (for dots)
  const dateEntities = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!data) return map;

    const add = (date: string | null, type: string) => {
      if (!date) return;
      if (!isTypeEnabled(type)) return;
      const dateOnly = toManilaDay(date);
      if (!map.has(dateOnly)) map.set(dateOnly, new Set());
      map.get(dateOnly)!.add(type);
    };

    for (const d of data.deliverables) {
      add(d.date, d.dateType === 'deadline' ? 'deliverable_deadline' : 'deliverable_review');
    }
    for (const m of data.meetings) add(m.date, 'meeting');
    for (const h of data.hearings) add(h.date, 'hearing');
    for (const f of data.filings) add(f.date, 'filing');
    for (const l of data.leaves) {
      const ls = new Date(l.periodStart + 'T00:00:00');
      const le = new Date(l.periodEnd + 'T00:00:00');
      for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) {
        const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        add(ds, 'leave');
      }
    }
    for (const h of data.holidays) add(h.date, 'holiday');
    for (const e of data.errands ?? []) add(e.date, 'errand');

    return map;
  }, [data, isTypeEnabled]);

  // Build date → entry details map (for tooltips & detail view)
  const dateDetails = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    if (!data) return map;

    const add = (date: string | null, entry: DayEntry) => {
      if (!date) return;
      if (!isTypeEnabled(entry.type)) return;
      const dateOnly = toManilaDay(date);
      if (!map.has(dateOnly)) map.set(dateOnly, []);
      map.get(dateOnly)!.push(entry);
    };

    const fmtTime = (iso: string | null): string | undefined => {
      if (!iso || !iso.includes('T') || isDateOnly(iso)) return undefined;
      try {
        return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
      } catch { return undefined; }
    };

    for (const d of data.deliverables) {
      const type = d.dateType === 'deadline' ? 'deliverable_deadline' : 'deliverable_review';
      const subLabel = d.dateType === 'deadline' ? 'Deadline' : getReviewLabel(d.reviewerIndex, d.reviewerCount);
      add(d.date, { type, name: d.name, id: d.id, entity: 'deliverables', matter: d.matter, subType: subLabel });
    }
    for (const m of data.meetings) add(m.date, { type: 'meeting', name: m.name, id: m.id, entity: 'meetings', matter: m.matter, time: fmtTime(m.date) });
    for (const h of data.hearings) add(h.date, { type: 'hearing', name: h.name, id: h.id, entity: 'hearings', matter: h.matter, time: fmtTime(h.date) });
    for (const f of data.filings) add(f.date, { type: 'filing', name: f.name, id: f.id, entity: 'filings', matter: f.matter, time: fmtTime(f.date) });
    for (const l of data.leaves) {
      const ls = new Date(l.periodStart + 'T00:00:00');
      const le = new Date(l.periodEnd + 'T00:00:00');
      for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) {
        const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        add(ds, { type: 'leave', name: l.lawyerName });
      }
    }
    for (const h of data.holidays) add(h.date, { type: 'holiday', name: h.name });
    for (const e of data.errands ?? []) {
      add(e.date, {
        type: 'errand',
        name: e.name,
        id: String(e.id),
        matter: [e.assigneeName, e.zoneName].filter(Boolean).join(' · '),
      });
    }

    return map;
  }, [data, isTypeEnabled]);

  // Build week rows
  const weeks = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDate = new Date(year, month, 0).getDate();
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const cells: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= lastDate; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [year, month]);

  const handleMouseEnter = useCallback((dateStr: string) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setHoveredDate(dateStr), 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = null;
    setHoveredDate(null);
  }, []);

  return (
    <div className="select-none">
      {/* Day headers */}
      <div className="grid grid-cols-7 px-2 pt-3 pb-2">
        {DAY_LABELS.map((d, i) => (
          <div
            key={d}
            className={`
              py-2 text-center text-[11px] font-semibold uppercase tracking-widest
              ${i >= 5 ? 'text-stone-300 dark:text-stone-500' : 'text-stone-400 dark:text-stone-400'}
            `}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Date grid */}
      <div className="px-2 pb-3 space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((day, di) => {
              const dateStr = day ? `${year}-${pad(month)}-${pad(day)}` : null;
              const isToday = dateStr === today;
              const isSelected = dateStr === selectedDate;
              const entities = dateStr ? dateEntities.get(dateStr) : undefined;
              const isHoliday = entities?.has('holiday');
              const isWeekend = di >= 5;
              const dotTypes = entities ? Array.from(entities).filter(t => t !== 'holiday') : [];
              const isHovered = dateStr === hoveredDate;
              const entries = dateStr ? dateDetails.get(dateStr) : undefined;
              const hasEntries = entries && entries.length > 0;

              return (
                <div
                  key={di}
                  className="relative"
                  onMouseEnter={() => dateStr && hasEntries && !showDetails && handleMouseEnter(dateStr)}
                  onMouseLeave={handleMouseLeave}
                >
                  <button
                    type="button"
                    disabled={!day}
                    onClick={() => dateStr && onSelectDate(dateStr === selectedDate ? '' : dateStr)}
                    className={`
                      relative flex flex-col rounded-xl w-full
                      ${showDetails ? 'items-start min-h-[100px] sm:min-h-[120px] py-1.5 px-1.5' : 'items-center min-h-[72px] sm:min-h-[80px] py-2 px-1'}
                      transition-all duration-200 ease-out
                      ${day ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'}
                      ${day && !isSelected ? 'hover:bg-stone-50 dark:hover:bg-stone-800/40 hover:shadow-sm' : ''}
                      ${isSelected
                        ? 'bg-gold-50/80 dark:bg-gold-900/20 ring-1 ring-inset ring-gold-300/60 dark:ring-gold-600/40 shadow-sm'
                        : ''
                      }
                      ${isHoliday && !isSelected ? 'bg-emerald-50/40 dark:bg-emerald-900/8' : ''}
                      ${!day ? 'opacity-0 pointer-events-none' : ''}
                    `}
                  >
                    {day && (
                      <>
                        <span
                          className={`
                            text-sm font-medium leading-none w-7 h-7 flex items-center justify-center rounded-full
                            transition-all duration-200 ${showDetails ? 'self-end' : ''}
                            ${isToday
                              ? 'bg-gold-500 text-white font-bold shadow-md shadow-gold-400/30 dark:shadow-gold-600/20'
                              : isSelected
                                ? 'text-gold-800 dark:text-gold-300 font-semibold'
                                : isWeekend
                                  ? 'text-stone-400 dark:text-stone-500'
                                  : 'text-stone-700 dark:text-stone-300'
                            }
                          `}
                        >
                          {day}
                        </span>

                        {showDetails && entries && entries.length > 0 ? (
                          /* Inline entry details grouped by type */
                          <DayDetailGroups entries={entries} onOpenEntity={onOpenEntity} />
                        ) : (
                          /* Dot indicators */
                          dotTypes.length > 0 && (
                            <div className="flex flex-wrap items-center justify-center gap-[3px] mt-auto pb-0.5">
                              {dotTypes.map((type) => (
                                <span
                                  key={`${filterKey}-${type}`}
                                  className={`w-[6px] h-[6px] rounded-full ${DOT_COLORS[type] ?? 'bg-stone-300'} ring-1 ring-white/60 dark:ring-black/30 animate-scale-in`}
                                />
                              ))}
                            </div>
                          )
                        )}
                      </>
                    )}
                  </button>

                  {/* Hover tooltip — only in dots mode */}
                  {!showDetails && isHovered && entries && entries.length > 0 && (
                    <DayTooltip entries={entries} column={di} isBottomHalf={wi >= weeks.length - 2} />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const GROUP_ORDER = ['deliverable_review', 'deliverable_deadline', 'filing', 'hearing', 'meeting', 'leave', 'holiday'];

function DayDetailGroups({ entries, onOpenEntity }: { entries: DayEntry[]; onOpenEntity?: (entity: string, id: string, name: string) => void }) {
  const grouped = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    for (const e of entries) {
      if (!map.has(e.type)) map.set(e.type, []);
      map.get(e.type)!.push(e);
    }
    // Sort groups by defined order
    const sorted = new Map<string, DayEntry[]>();
    for (const type of GROUP_ORDER) {
      if (map.has(type)) sorted.set(type, map.get(type)!);
    }
    // Any remaining types not in GROUP_ORDER
    for (const [type, items] of map) {
      if (!sorted.has(type)) sorted.set(type, items);
    }
    return sorted;
  }, [entries]);

  return (
    <div className="w-full mt-0.5 space-y-1 text-left">
      {Array.from(grouped.entries()).map(([type, items]) => (
        <div key={type}>
          <div className="flex items-center gap-1 mb-[1px]">
            <span className={`w-[5px] h-[5px] rounded-full ${DOT_COLORS[type] ?? 'bg-stone-300'}`} />
            <span className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {TYPE_LABELS[type] ?? type}{items.length > 1 ? `s (${items.length})` : ''}
            </span>
          </div>
          <div className="space-y-[1px] pl-2.5">
            {items.map((entry, idx) => {
              const isClickable = !!(entry.id && entry.entity && onOpenEntity);
              return (
                <div
                  key={idx}
                  className={`min-w-0 ${isClickable ? 'group cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-stone-100/80 dark:hover:bg-stone-700/30 transition-colors' : ''}`}
                  onClick={isClickable ? (e) => { e.stopPropagation(); onOpenEntity(entry.entity!, entry.id!, entry.name); } : undefined}
                >
                  <p className={`text-[9px] sm:text-[10px] font-medium leading-tight ${isClickable ? 'text-stone-700 dark:text-stone-300 group-hover:text-gold-700 dark:group-hover:text-gold-300' : 'text-stone-700 dark:text-stone-300'}`}>
                    {entry.time && <span className="font-mono text-stone-400 dark:text-stone-500">{entry.time} </span>}
                    {entry.name}
                  </p>
                  {(entry.matter || entry.subType) && (
                    <p className="text-[8px] sm:text-[9px] text-stone-400 dark:text-stone-500 leading-tight">
                      {entry.subType && <span className="font-semibold">{entry.subType}</span>}
                      {entry.subType && entry.matter && <span> · </span>}
                      {entry.matter}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function DayTooltip({ entries, column, isBottomHalf }: { entries: DayEntry[]; column: number; isBottomHalf: boolean }) {
  // Group entries by type
  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of entries) {
      if (!map.has(e.type)) map.set(e.type, []);
      map.get(e.type)!.push(e.name);
    }
    return map;
  }, [entries]);

  // Position tooltip: left-align for first 2 columns, right-align for last 2, center otherwise
  const alignClass = column <= 1
    ? 'left-0'
    : column >= 5
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';

  // Flip upward for bottom rows
  const verticalClass = isBottomHalf ? 'bottom-full mb-1' : 'top-full mt-1';

  return (
    <div
      className={`
        absolute ${verticalClass} z-50 ${alignClass}
        w-56 max-h-48 overflow-y-auto
        bg-[var(--card-bg)] border border-[var(--border-color)]
        rounded-xl shadow-[var(--shadow-elevated)] p-3
        animate-fade-in
      `}
    >
      <div className="space-y-2">
        {Array.from(grouped.entries()).map(([type, names]) => (
          <div key={type}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full ${TOOLTIP_DOT[type] ?? 'bg-stone-300'}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                {TYPE_LABELS[type] ?? type}{names.length > 1 ? `s (${names.length})` : ''}
              </span>
            </div>
            <div className="space-y-0.5 pl-3">
              {names.slice(0, 3).map((name, i) => (
                <p key={i} className="text-xs text-stone-600 dark:text-stone-400 truncate leading-relaxed">
                  {name}
                </p>
              ))}
              {names.length > 3 && (
                <p className="text-[10px] text-stone-400 dark:text-stone-500 italic">
                  +{names.length - 3} more
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-2 pt-2 border-t border-[var(--border-color)] text-center">
        Click to filter
      </p>
    </div>
  );
}
