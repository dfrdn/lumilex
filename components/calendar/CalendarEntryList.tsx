'use client';

import { useMemo, useState } from 'react';
import { FileText, Handshake, Gavel, FolderOpen, ChevronDown, Palmtree, UserMinus, CalendarOff, Bike } from 'lucide-react';
import type { FirmCalendarData } from '@/hooks/use-firm-calendar';
import type { CalendarFilterKey } from './calendar-types';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { isDateOnly, toManilaDay, toManilaInstant } from '@/lib/dates';

interface Props {
  data: FirmCalendarData | undefined;
  selectedDate: string | null;
  onOpenEntity: (entity: string, id: string, name: string) => void;
  enabledFilters: Set<CalendarFilterKey>;
}

type GroupKey = 'deliverables' | 'meetings' | 'hearings' | 'filings' | 'leaves' | 'holidays' | 'errands';

interface CalendarEntry {
  id: string;
  name: string;
  date: string;
  time?: string;
  matter?: string;
  status?: string;
  subtitle?: string;
  entity: string;
}

interface DeliverableGroup {
  id: string;
  name: string;
  matter: string;
  matterId: string | null;
  status: string;
  dates: { dateType: string; date: string; label: string; isSelected: boolean; reviewerIndex?: number; reviewerCount?: number }[];
}

const GROUP_CONFIG: Record<GroupKey, {
  label: string;
  icon: typeof FileText;
  accentClass: string;
  dotClass: string;
  barClass: string;
  badgeBg: string;
}> = {
  deliverables: {
    label: 'Deliverables',
    icon: FileText,
    accentClass: 'text-violet-500',
    dotClass: 'bg-violet-400',
    barClass: 'bg-violet-400',
    badgeBg: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
  },
  meetings: {
    label: 'Meetings',
    icon: Handshake,
    accentClass: 'text-blue-500',
    dotClass: 'bg-blue-400',
    barClass: 'bg-blue-400',
    badgeBg: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  },
  hearings: {
    label: 'Hearings',
    icon: Gavel,
    accentClass: 'text-rose-500',
    dotClass: 'bg-rose-400',
    barClass: 'bg-rose-400',
    badgeBg: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
  },
  filings: {
    label: 'Filings & Deadlines',
    icon: FolderOpen,
    accentClass: 'text-amber-500',
    dotClass: 'bg-amber-500',
    barClass: 'bg-amber-500',
    badgeBg: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  },
  leaves: {
    label: 'Leaves',
    icon: UserMinus,
    accentClass: 'text-cyan-500',
    dotClass: 'bg-cyan-400',
    barClass: 'bg-cyan-400',
    badgeBg: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-400',
  },
  holidays: {
    label: 'Holidays',
    icon: Palmtree,
    accentClass: 'text-emerald-500 dark:text-emerald-400',
    dotClass: 'bg-emerald-400',
    barClass: 'bg-emerald-400',
    badgeBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  },
  errands: {
    label: 'Liaison Errands',
    icon: Bike,
    accentClass: 'text-fuchsia-500',
    dotClass: 'bg-fuchsia-400',
    barClass: 'bg-fuchsia-400',
    badgeBg: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-500/10 dark:text-fuchsia-400',
  },
};

const DATE_TYPE_LABELS: Record<string, string> = {
  review: 'Review',
  deadline: 'Deadline',
};

function getReviewLabel(reviewerIndex?: number, reviewerCount?: number): string {
  if (reviewerIndex == null || !reviewerCount || reviewerCount <= 0) return 'Review';
  if (reviewerCount === 1) return 'Review';
  if (reviewerIndex === 0) return 'Initial Review';
  if (reviewerIndex === reviewerCount - 1) return 'Final Review';
  return ['2nd', '3rd', '4th'][reviewerIndex - 1] + ' Review';
}

const DATE_TYPE_COLORS: Record<string, string> = {
  review: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10',
  deadline: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10',
};

const STATUS_COLORS: Record<string, string> = {
  [DELIVERABLE_STATUS.NOT_STARTED]: 'bg-stone-100 text-stone-600 dark:bg-stone-700/50 dark:text-stone-400',
  [DELIVERABLE_STATUS.DRAFTING]: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  [DELIVERABLE_STATUS.UNDER_REVIEW]: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  [DELIVERABLE_STATUS.REVISING]: 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400',
  [DELIVERABLE_STATUS.FINALIZING]: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
  'Scheduled': 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  'Attended': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  'Cancelled': 'bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400',
  'Postponed': 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400',
  'Approved': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  'Pending': 'bg-yellow-50 text-yellow-600 dark:bg-yellow-500/10 dark:text-yellow-400',
};

/** The Manila day of a bare YYYY-MM-DD or a full ISO datetime, or "—" when unparseable. */
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(toManilaInstant(dateStr));
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'Asia/Manila' });
}

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr || !dateStr.includes('T') || isDateOnly(dateStr)) return '';
  try {
    return new Date(dateStr).toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Manila',
    });
  } catch {
    return '';
  }
}

function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = formatTime(start);
  if (!s) return '';
  const e = formatTime(end);
  if (!e || e === s) return s;
  return `${s} – ${e}`;
}

export default function CalendarEntryList({ data, selectedDate, onOpenEntity, enabledFilters }: Props) {
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());
  const [expandedDeliverables, setExpandedDeliverables] = useState<Set<string>>(new Set());

  const { deliverableGroups, otherGroups } = useMemo(() => {
    if (!data) return { deliverableGroups: [], otherGroups: {} as Record<Exclude<GroupKey, 'deliverables'>, CalendarEntry[]> };

    const matchesDate = (date: string | null) => {
      if (!date) return false;
      if (selectedDate) return toManilaDay(date) === selectedDate;
      return true;
    };

    const showDeadlines = enabledFilters.has('deadline');
    const showReviews = enabledFilters.has('review');
    const showMeetings = enabledFilters.has('meeting');
    const showHearings = enabledFilters.has('hearing');
    const showFilings = enabledFilters.has('filing');
    const showLeaves = enabledFilters.has('leave');
    const showHolidays = enabledFilters.has('holiday');
    const showErrands = enabledFilters.has('errand');

    // ── Deliverables: group by deliverable ID ───────────────────
    const groupMap = new Map<string, DeliverableGroup>();

    for (const d of data.deliverables) {
      if (!d.date) continue;
      const isDeadline = d.dateType === 'deadline';
      if (isDeadline && !showDeadlines) continue;
      if (!isDeadline && !showReviews) continue;

      if (!groupMap.has(d.id)) {
        groupMap.set(d.id, {
          id: d.id,
          name: d.name,
          matter: d.matter,
          matterId: d.matterId,
          status: d.status,
          dates: [],
        });
      }

      groupMap.get(d.id)!.dates.push({
        dateType: d.dateType,
        date: d.date,
        label: d.dateType === 'review'
          ? getReviewLabel(d.reviewerIndex, d.reviewerCount)
          : (DATE_TYPE_LABELS[d.dateType] ?? d.dateType),
        isSelected: !!selectedDate && d.date.slice(0, 10) === selectedDate,
        reviewerIndex: d.reviewerIndex,
        reviewerCount: d.reviewerCount,
      });
    }

    // Sort each deliverable's dates chronologically
    for (const g of groupMap.values()) {
      g.dates.sort((a, b) => a.date.localeCompare(b.date));
    }

    // When a date is selected: only show deliverable groups with at least one date on that day
    const deliverableGroups = Array.from(groupMap.values()).filter((g) =>
      selectedDate ? g.dates.some((d) => d.date.slice(0, 10) === selectedDate) : true,
    );

    // ── Meetings ────────────────────────────────────────────────
    const meetings: CalendarEntry[] = !showMeetings ? [] : data.meetings
      .filter((m) => matchesDate(m.date))
      .map((m) => ({
        id: m.id,
        name: m.name,
        date: m.date ?? '',
        time: formatTimeRange(m.date, m.endDate),
        matter: m.matter,
        subtitle: m.type,
        status: m.isAttended ? 'Attended' : undefined,
        entity: 'meetings',
      }));

    // ── Hearings ────────────────────────────────────────────────
    const hearings: CalendarEntry[] = !showHearings ? [] : data.hearings
      .filter((h) => matchesDate(h.date))
      .map((h) => ({
        id: h.id,
        name: h.name,
        date: h.date ?? '',
        time: formatTime(h.date),
        matter: h.matter,
        status: h.status,
        subtitle: h.type,
        entity: 'hearings',
      }));

    // ── Filings ─────────────────────────────────────────────────
    const filings: CalendarEntry[] = !showFilings ? [] : data.filings
      .filter((f) => matchesDate(f.date))
      .map((f) => ({
        id: f.id,
        name: f.name,
        date: f.date ?? '',
        matter: f.matter,
        status: f.status,
        subtitle: 'Filing Deadline',
        entity: 'filings',
      }));

    // ── Leaves ──────────────────────────────────────────────────
    const leaves: CalendarEntry[] = [];
    if (showLeaves) for (const l of data.leaves) {
      const matches = selectedDate
        ? l.periodStart <= selectedDate && l.periodEnd >= selectedDate
        : true;
      if (matches) {
        leaves.push({
          id: l.id,
          name: l.lawyerName,
          date: l.periodStart,
          subtitle: l.leaveType || 'Leave',
          status: l.approved ? 'Approved' : l.status || 'Pending',
          entity: 'leaves',
        });
      }
    }

    // ── Holidays ────────────────────────────────────────────────
    const holidays: CalendarEntry[] = !showHolidays ? [] : data.holidays
      .filter((h) => matchesDate(h.date))
      .map((h) => ({
        id: h.date,
        name: h.name,
        date: h.date,
        subtitle: h.type === 'regular' ? 'Regular Holiday' : 'Special Non-Working',
        entity: 'holidays',
      }));

    // ── Errands ─────────────────────────────────────────────────
    const errands: CalendarEntry[] = !showErrands ? [] : (data.errands ?? [])
      .filter((e) => matchesDate(e.date))
      .map((e) => ({
        id: String(e.id),
        name: e.name,
        date: e.date,
        matter: e.matter,
        subtitle: [e.assigneeName, e.zoneName].filter(Boolean).join(' · '),
        status: e.status.replace('_', ' '),
        entity: 'errands',
      }));

    return {
      deliverableGroups,
      otherGroups: { meetings, hearings, filings, leaves, holidays, errands },
    };
  }, [data, selectedDate, enabledFilters]);

  const toggleGroup = (key: GroupKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleDeliverable = (id: string) => {
    setExpandedDeliverables((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalEntries =
    deliverableGroups.length +
    Object.values(otherGroups).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);

  if (!data) return null;

  return (
    <div className="space-y-3">
      {totalEntries === 0 && (
        <div className="flex flex-col items-center justify-center py-14 text-stone-400 dark:text-stone-500">
          <CalendarOff className="w-8 h-8 mb-3 opacity-40" />
          <p className="text-sm font-medium">
            {selectedDate ? 'No entries on this date' : 'No entries this month'}
          </p>
          <p className="text-xs mt-1 opacity-60">
            {selectedDate ? 'Try selecting a different date' : 'Events will appear here as they are scheduled'}
          </p>
        </div>
      )}

      {/* ── Deliverables (grouped) ──────────────────────────────── */}
      {deliverableGroups.length > 0 && (() => {
        const config = GROUP_CONFIG.deliverables;
        const Icon = config.icon;
        const isGroupCollapsed = collapsed.has('deliverables');

        return (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-[var(--shadow-card)] transition-shadow duration-200 hover:shadow-[var(--shadow-card-hover)] animate-fade-in">
            {/* Group header */}
            <button
              type="button"
              onClick={() => toggleGroup('deliverables')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-stone-50/60 dark:hover:bg-stone-800/30 transition-colors cursor-pointer"
            >
              <div className={`w-1 h-5 rounded-full ${config.barClass} shrink-0 opacity-80`} />
              <Icon className={`w-4 h-4 ${config.accentClass} shrink-0`} />
              <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">{config.label}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${config.badgeBg}`}>
                {deliverableGroups.length}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-stone-400 ml-auto transition-transform duration-200 dark:text-stone-500 ${isGroupCollapsed ? '-rotate-90' : ''}`}
              />
            </button>

            {/* Deliverable group rows */}
            {!isGroupCollapsed && (
              <div className="border-t border-[var(--border-color)]">
                {deliverableGroups.map((group, idx) => {
                  const isExpanded = expandedDeliverables.has(group.id);
                  return (
                    <div key={group.id} className={idx > 0 ? 'border-t border-[var(--border-color)]' : ''}>
                      {/* Deliverable row — click to expand dates, secondary click navigates */}
                      <div className="flex items-center gap-3 px-4 py-2.5 group">
                        {/* Expand toggle */}
                        <button
                          type="button"
                          onClick={() => toggleDeliverable(group.id)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <ChevronDown
                            className={`w-3 h-3 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${isExpanded ? '' : '-rotate-90'}`}
                          />
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dotClass}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-300 truncate block">
                              {group.name}
                            </span>
                            {group.matter && (
                              <p className="text-xs text-stone-400 dark:text-stone-500 truncate mt-0.5">{group.matter}</p>
                            )}
                          </div>
                        </button>

                        {/* Status + navigate */}
                        <div className="flex items-center gap-2 shrink-0">
                          {group.status && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[group.status] ?? 'bg-stone-100 text-stone-500 dark:bg-stone-700/50 dark:text-stone-400'}`}>
                              {group.status}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenEntity('deliverables', group.id, group.name)}
                            className="text-[10px] text-stone-400 hover:text-gold-600 dark:hover:text-gold-400 transition-colors cursor-pointer px-1 dark:text-stone-500"
                            title="Open deliverable"
                          >
                            {group.dates.length} {group.dates.length === 1 ? 'date' : 'dates'}
                          </button>
                        </div>
                      </div>

                      {/* Expanded date sub-rows */}
                      {isExpanded && (
                        <div className="border-t border-[var(--border-color)] bg-stone-50/50 dark:bg-stone-900/20">
                          {group.dates.map((d, di) => (
                            <div
                              key={`${d.dateType}-${d.date}`}
                              className={`flex items-center gap-3 px-6 py-2 ${di > 0 ? 'border-t border-[var(--border-color)]' : ''} ${d.isSelected ? 'bg-violet-50/40 dark:bg-violet-500/5' : ''}`}
                            >
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${DATE_TYPE_COLORS[d.dateType] ?? 'bg-stone-100 text-stone-500 dark:bg-stone-700 dark:text-stone-400'}`}>
                                {d.label}
                              </span>
                              <span className="flex-1" />
                              {d.isSelected && (
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                              )}
                              <span className="text-xs text-stone-400 dark:text-stone-500 tabular-nums font-mono">
                                {formatDate(d.date)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── All other groups (meetings, hearings, filings, leaves, holidays) ── */}
      {(Object.keys(GROUP_CONFIG).filter((k) => k !== 'deliverables') as Exclude<GroupKey, 'deliverables'>[]).map((key) => {
        const entries = otherGroups[key];
        if (!entries || entries.length === 0) return null;
        const config = GROUP_CONFIG[key];
        const Icon = config.icon;
        const isCollapsed = collapsed.has(key);

        return (
          <div
            key={key}
            className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-[var(--shadow-card)] transition-shadow duration-200 hover:shadow-[var(--shadow-card-hover)] animate-fade-in"
          >
            <button
              type="button"
              onClick={() => toggleGroup(key)}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-stone-50/60 dark:hover:bg-stone-800/30 transition-colors cursor-pointer"
            >
              <div className={`w-1 h-5 rounded-full ${config.barClass} shrink-0 opacity-80`} />
              <Icon className={`w-4 h-4 ${config.accentClass} shrink-0`} />
              <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">{config.label}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${config.badgeBg}`}>
                {entries.length}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-stone-400 ml-auto transition-transform duration-200 dark:text-stone-500 ${isCollapsed ? '-rotate-90' : ''}`}
              />
            </button>

            {!isCollapsed && (
              <div className="border-t border-[var(--border-color)]">
                {entries.map((entry, idx) => {
                  const isClickable = key !== 'holidays' && key !== 'leaves' && key !== 'errands';
                  return (
                    <button
                      key={`${entry.id}-${entry.date}-${idx}`}
                      type="button"
                      disabled={!isClickable}
                      onClick={() => isClickable && onOpenEntity(entry.entity, entry.id, entry.name)}
                      className={`
                        group w-full text-left px-4 py-2.5 flex items-center gap-3
                        transition-all duration-150
                        ${idx > 0 ? 'border-t border-[var(--border-color)]' : ''}
                        ${isClickable
                          ? 'hover:bg-gold-50/40 dark:hover:bg-gold-900/10 cursor-pointer hover:pl-5'
                          : 'cursor-default'
                        }
                      `}
                    >
                      <span className={`
                        w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-200
                        ${config.dotClass}
                        ${isClickable ? 'group-hover:w-2 group-hover:h-2' : ''}
                      `} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-stone-700 dark:text-stone-300 truncate">
                            {entry.name}
                          </span>
                          {entry.subtitle && (
                            <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500 shrink-0">
                              {entry.subtitle}
                            </span>
                          )}
                        </div>
                        {entry.matter && (
                          <p className="text-xs text-stone-400 dark:text-stone-500 truncate mt-0.5">{entry.matter}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {entry.status && (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[entry.status] ?? 'bg-stone-100 text-stone-500 dark:bg-stone-700/50 dark:text-stone-400'}`}>
                            {entry.status}
                          </span>
                        )}
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs text-stone-400 dark:text-stone-500 tabular-nums font-mono">
                            {formatDate(entry.date)}
                          </span>
                          {entry.time && (
                            <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-300 tabular-nums font-mono">
                              {entry.time}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
