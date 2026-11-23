'use client';

import { useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Loader2, List, LayoutGrid, Download } from 'lucide-react';
import { useFirmCalendarMonth } from '@/hooks/use-firm-calendar';
import CalendarGrid from './CalendarGrid';
import CalendarEntryList from './CalendarEntryList';
import ExportPdfModal from './ExportPdfModal';
import type { CalendarFilterKey } from './calendar-types';

interface Props {
  onOpenEntity: (entity: string, id: string, name: string) => void;
  /** Shown under the header: the dashboard Calendar's Hearings and Meetings tabs. */
  tabs?: React.ReactNode;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const LEGEND_ITEMS: { key: CalendarFilterKey; label: string; color: string; ring: string }[] = [
  { key: 'meeting', label: 'Meetings', color: 'bg-blue-400', ring: 'ring-blue-400/20' },
  { key: 'hearing', label: 'Hearings', color: 'bg-rose-400', ring: 'ring-rose-400/20' },
  { key: 'filing', label: 'Filings', color: 'bg-amber-500', ring: 'ring-amber-500/20' },
  { key: 'deadline', label: 'Deadlines', color: 'bg-orange-400', ring: 'ring-orange-400/20' },
  { key: 'review', label: 'Reviews', color: 'bg-violet-400', ring: 'ring-violet-400/20' },
  { key: 'leave', label: 'Leaves', color: 'bg-cyan-400', ring: 'ring-cyan-400/20' },
  { key: 'holiday', label: 'Holidays', color: 'bg-emerald-400', ring: 'ring-emerald-400/20' },
  { key: 'errand', label: 'Errands', color: 'bg-fuchsia-400', ring: 'ring-fuchsia-400/20' },
];

// Errands are off by default — they're operational logistics, not firm events.
const DEFAULT_FILTERS: CalendarFilterKey[] = LEGEND_ITEMS
  .filter((i) => i.key !== 'errand')
  .map((i) => i.key);
const ALL_FILTERS: CalendarFilterKey[] = LEGEND_ITEMS.map((i) => i.key);

export default function FirmCalendarView({ onOpenEntity, tabs }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [enabledFilters, setEnabledFilters] = useState<Set<CalendarFilterKey>>(
    () => new Set(DEFAULT_FILTERS),
  );
  const [showDetails, setShowDetails] = useState(false);

  const { data, isLoading, isValidating } = useFirmCalendarMonth(year, month);

  const toggleFilter = useCallback((key: CalendarFilterKey) => {
    setEnabledFilters((prev) => {
      // First click from the unfiltered state → solo-select this one
      if (prev.size === ALL_FILTERS.length) {
        return new Set([key]);
      }
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Deselecting the last active filter returns to the unfiltered state
        if (next.size === 0) return new Set(ALL_FILTERS);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setEnabledFilters(new Set(DEFAULT_FILTERS));
  }, []);

  const isFiltered =
    enabledFilters.size !== DEFAULT_FILTERS.length ||
    !DEFAULT_FILTERS.every((k) => enabledFilters.has(k));

  // A key that changes whenever the filter set changes — used to retrigger
  // fade-in animations on filtered content.
  const filterKey = useMemo(
    () => Array.from(enabledFilters).sort().join('|'),
    [enabledFilters],
  );

  const goToPrev = useCallback(() => {
    setSelectedDate(null);
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }, [month]);

  const goToNext = useCallback(() => {
    setSelectedDate(null);
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }, [month]);

  const [showExportModal, setShowExportModal] = useState(false);

  const goToToday = useCallback(() => {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedDate(null);
  }, []);

  const counts = useMemo(() => {
    if (!data) return { deliverables: 0, meetings: 0, hearings: 0, filings: 0, leaves: 0, holidays: 0, errands: 0 };
    return {
      deliverables: data.deliverables.length,
      meetings: data.meetings.length,
      hearings: data.hearings.length,
      filings: data.filings.length,
      leaves: data.leaves.length,
      holidays: data.holidays.length,
      errands: data.errands?.length ?? 0,
    };
  }, [data]);

  const totalEvents = counts.deliverables + counts.meetings + counts.hearings + counts.filings + counts.leaves;

  return (
    <div className="space-y-8 animate-fade-up">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-gold-50 to-gold-100 dark:from-gold-900/30 dark:to-gold-800/20 flex items-center justify-center shadow-sm ring-1 ring-gold-200/40 dark:ring-gold-700/30">
              <Calendar className="w-5.5 h-5.5 text-gold-600 dark:text-gold-400" />
            </div>
            {(isLoading || isValidating) && (
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--card-bg)] flex items-center justify-center">
                <Loader2 className="w-3 h-3 text-gold-500 animate-spin dark:text-gold-400" />
              </div>
            )}
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Firm Calendar
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 tracking-wide">
              {totalEvents} event{totalEvents !== 1 ? 's' : ''} this month
              {counts.holidays > 0 && ` \u00b7 ${counts.holidays} holiday${counts.holidays !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {/* Legend — desktop (clickable filters) */}
        <div className="hidden lg:flex items-center gap-1 flex-wrap">
          {LEGEND_ITEMS.map((item) => {
            const active = enabledFilters.has(item.key);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleFilter(item.key)}
                aria-pressed={active}
                title={active ? `Hide ${item.label}` : `Show ${item.label}`}
                className={`
                  flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer
                  transition-all duration-150 active:scale-[0.96]
                  ${active
                    ? 'hover:bg-stone-100 dark:hover:bg-stone-800/60'
                    : 'opacity-40 hover:opacity-70 hover:bg-stone-50 dark:hover:bg-stone-800/40'
                  }
                `}
              >
                <span className={`w-2 h-2 rounded-full ${item.color} ring-2 ${item.ring}`} />
                <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wider">
                  {item.label}
                </span>
              </button>
            );
          })}
          {isFiltered && (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-1 text-[10px] font-semibold text-gold-600 hover:text-gold-700 dark:text-gold-400 dark:hover:text-gold-300 uppercase tracking-wider px-2 py-1.5 rounded-lg hover:bg-gold-50 dark:hover:bg-gold-900/20 transition-colors cursor-pointer"
            >
              Show all
            </button>
          )}
        </div>
      </div>

      {tabs}

      {/* ── Month navigation ───────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goToPrev}
            className="group w-9 h-9 rounded-xl flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 dark:hover:text-stone-300 transition-all duration-200 active:scale-[0.90] cursor-pointer dark:text-stone-500"
          >
            <ChevronLeft className="w-4.5 h-4.5 group-hover:-translate-x-0.5 transition-transform duration-200" />
          </button>

          <h2 key={`${year}-${month}`} className="font-serif text-xl font-semibold text-stone-800 dark:text-stone-200 min-w-[200px] text-center select-none animate-fade-in">
            {MONTH_NAMES[month - 1]} {year}
          </h2>

          <button
            type="button"
            onClick={goToNext}
            className="group w-9 h-9 rounded-xl flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 dark:hover:text-stone-300 transition-all duration-200 active:scale-[0.90] cursor-pointer dark:text-stone-500"
          >
            <ChevronRight className="w-4.5 h-4.5 group-hover:translate-x-0.5 transition-transform duration-200" />
          </button>

          {(isLoading || isValidating) && (
            <Loader2 className="w-4 h-4 text-gold-500 animate-spin ml-1 dark:text-gold-400" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-stone-100 dark:bg-stone-800/50 rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => setShowDetails(false)}
              className={`p-1.5 rounded-lg transition-all duration-200 cursor-pointer ${!showDetails ? 'bg-white dark:bg-stone-700 shadow-sm text-stone-700 dark:text-stone-200' : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300'}`}
              title="Dots view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className={`p-1.5 rounded-lg transition-all duration-200 cursor-pointer ${showDetails ? 'bg-white dark:bg-stone-700 shadow-sm text-stone-700 dark:text-stone-200' : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300'}`}
              title="Detail view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={goToToday}
            className="text-xs font-semibold px-4 py-2 rounded-xl border border-gold-200/60 dark:border-gold-700/40 text-gold-700 dark:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-900/15 hover:border-gold-300 dark:hover:border-gold-600/50 transition-all duration-200 active:scale-[0.95] cursor-pointer"
          >
            Today
          </button>

          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl border border-gold-200/60 dark:border-gold-700/40 text-gold-700 dark:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-900/15 hover:border-gold-300 dark:hover:border-gold-600/50 transition-all duration-200 active:scale-[0.95] cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export PDF
          </button>
        </div>
      </div>

      <ExportPdfModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        defaultYear={year}
        defaultMonth={month - 1}
      />

      {/* ── Selected date chip ─────────────────────────────────── */}
      {selectedDate && (
        <div className="flex items-center gap-3 animate-fade-in">
          <div className="h-px flex-1 bg-gradient-to-r from-gold-200/60 to-transparent dark:from-gold-800/30" />
          <span className="text-sm font-medium text-gold-700 dark:text-gold-400 tracking-wide">
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-PH', {
              weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
            })}
          </span>
          <button
            type="button"
            onClick={() => setSelectedDate(null)}
            className="text-[11px] font-medium text-stone-400 hover:text-gold-600 dark:hover:text-gold-400 transition-colors cursor-pointer dark:text-stone-500"
          >
            Show all
          </button>
          <div className="h-px flex-1 bg-gradient-to-l from-gold-200/60 to-transparent dark:from-gold-800/30" />
        </div>
      )}

      {/* ── Calendar grid ──────────────────────────────────────── */}
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-[var(--shadow-card)]">
        <CalendarGrid
          year={year}
          month={month}
          data={data}
          selectedDate={selectedDate}
          onSelectDate={(d) => setSelectedDate(d || null)}
          enabledFilters={enabledFilters}
          filterKey={filterKey}
          showDetails={showDetails}
          onOpenEntity={onOpenEntity}
        />
      </div>

      {/* ── Mobile legend (clickable filters) ──────────────────── */}
      <div className="flex lg:hidden flex-wrap items-center gap-2 justify-center">
        {LEGEND_ITEMS.map((item) => {
          const active = enabledFilters.has(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => toggleFilter(item.key)}
              aria-pressed={active}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer
                transition-all duration-150 active:scale-[0.96]
                ${active
                  ? 'bg-stone-50 dark:bg-stone-800/30'
                  : 'bg-stone-50/40 dark:bg-stone-800/10 opacity-40'
                }
              `}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${item.color}`} />
              <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
                {item.label}
              </span>
            </button>
          );
        })}
        {isFiltered && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-[10px] font-semibold text-gold-600 dark:text-gold-400 uppercase tracking-wide px-2 py-1 rounded-md hover:bg-gold-50 dark:hover:bg-gold-900/20 transition-colors cursor-pointer"
          >
            Show all
          </button>
        )}
      </div>

      {/* ── Entry list ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h3 className="font-serif text-lg font-semibold text-stone-800 dark:text-stone-200">
            {selectedDate ? 'Entries' : 'All Entries This Month'}
          </h3>
          <div className="h-px flex-1 bg-[var(--border-color)]" />
        </div>
        <CalendarEntryList
          data={data}
          selectedDate={selectedDate}
          onOpenEntity={onOpenEntity}
          enabledFilters={enabledFilters}
        />
      </div>
    </div>
  );
}
