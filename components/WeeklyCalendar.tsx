'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Check, X, Loader2 } from 'lucide-react';
import MeetingActionButtons from '@/components/MeetingActionButtons';
import HearingActionButtons from '@/components/HearingActionButtons';
import FilingActionButtons from '@/components/FilingActionButtons';
import type { NotionMeeting, NotionHearing, NotionFiling, NotionTask } from '@/types/notion';
import { useDetailPane } from '@/components/DetailPaneContext';
import { isDateOnly, toManilaDay, weekRange } from '@/lib/dates';

/** Map CalendarEvent.kind to the corresponding DetailPane entity name. */
const KIND_TO_ENTITY: Record<'meeting' | 'hearing' | 'filing' | 'task', string> = {
  meeting: 'meetings',
  hearing: 'hearings',
  filing: 'filings',
  task: 'tasks',
};

// ── Badge colors ────────────────────────────────────────────
const typeColors: Record<string, string> = {
  'External Meeting': 'bg-blue-100 text-blue-700 dark:bg-[rgba(91,155,213,0.12)] dark:text-[#5B9BD5]',
  'Internal Discussion': 'bg-purple-100 text-purple-700 dark:bg-[rgba(139,126,200,0.12)] dark:text-[#8B7EC8]',
  'Client Meeting': 'bg-gold-100 text-gold-700 dark:bg-[rgba(74,155,142,0.12)] dark:text-[#4A9B8E]',
  'Hearing': 'bg-red-100 text-red-700 dark:bg-[rgba(212,106,106,0.12)] dark:text-[#D46A6A]',
  'Filing': 'bg-teal-100 text-teal-700 dark:bg-[rgba(212,148,58,0.12)] dark:text-[#D4943A]',
};

function badgeClass(type: string): string {
  return typeColors[type] ?? 'bg-stone-100 text-stone-600 dark:bg-[rgba(255,255,255,0.06)] dark:text-[#9B978F]';
}

// ── Date helpers ───────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function fmtISO(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

function weekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Types ──────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  name: string;
  type: string;
  date: string;
  time: string;
  rawISO: string;
  href: string;
  kind: 'meeting' | 'hearing' | 'filing' | 'task';
  isAttended: boolean;
  attendeeIds: string[];
  matterId: string | null;
  matterName: string;
  status: string;
}

const kindStyles: Record<CalendarEvent['kind'], { bg: string; border: string }> = {
  meeting: { bg: 'bg-blue-50 dark:bg-[rgba(91,155,213,0.08)]', border: 'border-blue-400 dark:border-[#5B9BD5]' },
  hearing: { bg: 'bg-red-50 dark:bg-[rgba(212,106,106,0.08)]', border: 'border-red-400 dark:border-[#D46A6A]' },
  filing: { bg: 'bg-teal-50 dark:bg-[rgba(212,148,58,0.08)]', border: 'border-teal-400 dark:border-[#D4943A]' },
  task: { bg: 'bg-green-50 dark:bg-[rgba(107,175,122,0.08)]', border: 'border-green-400 dark:border-[#6BAF7A]' },
};

function fmtTime(isoStr: string | null): string {
  if (!isoStr || !isoStr.includes('T') || isDateOnly(isoStr)) return '';
  try {
    return new Date(isoStr).toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Manila',
    });
  } catch {
    return '';
  }
}

interface Props {
  initialMeetings: NotionMeeting[];
  initialHearings: NotionHearing[];
  initialFilings?: NotionFiling[];
  initialTasks?: NotionTask[];
  initialWeekStart: string;
  apiEndpoint?: string;
}

export default function WeeklyCalendar({
  initialMeetings,
  initialHearings,
  initialFilings = [],
  initialTasks = [],
  initialWeekStart,
  apiEndpoint = '/api/firm-calendar',
}: Props) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const initialMonday = new Date(initialWeekStart + 'T00:00:00');
  const { openPane } = useDetailPane();

  const [monday, setMonday] = useState(initialMonday);
  const [meetings, setMeetings] = useState(initialMeetings);
  const [hearings, setHearings] = useState(initialHearings);
  const [filings, setFilings] = useState(initialFilings);
  const [tasks, setTasks] = useState(initialTasks);
  const [loading, setLoading] = useState(false);
  // Optimistic: track IDs marked as attended or cancelled locally
  const [attendedIds, setAttendedIds] = useState<Set<string>>(new Set());
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());

  const isCurrentWeek = fmtISO(monday) === weekRange().start;

  const events: CalendarEvent[] = [
    ...meetings.map((m) => ({
      id: m.id, name: m.name, type: m.type,
      date: m.date ? toManilaDay(m.date) : '', time: fmtTime(m.date),
      rawISO: m.date ?? '', href: `/dashboard/meetings/${m.id}`,
      kind: 'meeting' as const, isAttended: m.isAttended || attendedIds.has(m.id),
      attendeeIds: m.attendeeIds, matterId: m.matterId,
      matterName: m.matter, status: '',
    })),
    ...hearings.map((h) => ({
      id: h.id, name: h.name, type: h.type,
      date: h.date ? toManilaDay(h.date) : '', time: fmtTime(h.date),
      rawISO: h.date ?? '', href: `/dashboard/hearings/${h.id}`,
      kind: 'hearing' as const, isAttended: h.isAttended || attendedIds.has(h.id),
      attendeeIds: h.attendeeIds, matterId: h.matterId,
      matterName: h.matter, status: cancelledIds.has(h.id) ? 'Cancelled' : h.status,
    })),
    ...filings.map((f) => ({
      id: f.id, name: f.name, type: 'Filing',
      date: f.date?.split('T')[0] ?? '', time: fmtTime(f.date),
      rawISO: f.date ?? '', href: `/dashboard/deliverables/${f.id}`,
      kind: 'filing' as const, isAttended: false,
      attendeeIds: f.attendeeIds, matterId: f.matterId,
      matterName: f.matter, status: f.status,
    })),
    ...tasks.map((t) => ({
      id: t.id, name: t.name, type: t.priority || 'Task',
      date: t.dueDate ?? '', time: '', rawISO: t.dueDate ?? '',
      href: `/dashboard/tasks/${t.id}`, kind: 'task' as const,
      isAttended: false, attendeeIds: [], matterId: null,
      matterName: '', status: '',
    })),
  ];

  const days = weekDates(monday);
  const byDate = new Map<string, CalendarEvent[]>();
  for (const d of days) byDate.set(fmtISO(d), []);
  for (const ev of events) {
    const bucket = byDate.get(ev.date);
    if (bucket) bucket.push(ev);
  }

  for (const [, dayEvents] of byDate) {
    dayEvents.sort((a, b) => {
      if (a.time && !b.time) return -1;
      if (!a.time && b.time) return 1;
      return a.rawISO.localeCompare(b.rawISO);
    });
  }

  const fetchWeek = useCallback(async (mon: Date) => {
    const start = fmtISO(mon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const end = fmtISO(sun);
    setLoading(true);
    try {
      const sep = apiEndpoint.includes('?') ? '&' : '?';
      const res = await fetch(`${apiEndpoint}${sep}start=${start}&end=${end}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setMeetings(data.meetings ?? []);
      setHearings(data.hearings ?? []);
      setFilings(data.filings ?? []);
      setTasks(data.tasks ?? []);
      setAttendedIds(new Set());
      setCancelledIds(new Set());
    } catch {
      // Keep current data on error
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

  const goToPrev = () => {
    const prev = new Date(monday);
    prev.setDate(monday.getDate() - 7);
    setMonday(prev);
  };

  const goToNext = () => {
    const next = new Date(monday);
    next.setDate(monday.getDate() + 7);
    setMonday(next);
  };

  const goToThisWeek = () => {
    setMonday(getMonday(new Date(`${weekRange().start}T00:00:00`)));
  };

  useEffect(() => {
    if (fmtISO(monday) !== initialWeekStart) {
      fetchWeek(monday);
    } else {
      setMeetings(initialMeetings);
      setHearings(initialHearings);
      setFilings(initialFilings);
      setTasks(initialTasks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmtISO(monday)]);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekLabel = `${monday.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  function renderActionButton(ev: CalendarEvent, compact = false) {
    if (ev.kind === 'meeting') {
      return (
        <MeetingActionButtons
          meetingId={ev.id} meetingName={ev.name} meetingType={ev.type}
          meetingDate={ev.rawISO || null} isAttended={ev.isAttended}
          attendeeIds={ev.attendeeIds} matterId={ev.matterId}
          matterName={ev.matterName} compact={compact}
          onStatusChange={() => setAttendedIds((s) => new Set(s).add(ev.id))}
        />
      );
    }
    if (ev.kind === 'hearing') {
      return (
        <HearingActionButtons
          hearingId={ev.id} hearingName={ev.name} hearingType={ev.type}
          hearingDate={ev.rawISO || null} isAttended={ev.isAttended}
          status={ev.status} attendeeIds={ev.attendeeIds}
          matterId={ev.matterId} matterName={ev.matterName} compact={compact}
          onStatusChange={(action) => {
            if (action === 'cancelled') {
              setCancelledIds((s) => new Set(s).add(ev.id));
            } else {
              setAttendedIds((s) => new Set(s).add(ev.id));
            }
          }}
        />
      );
    }
    if (ev.kind === 'filing') {
      return (
        <FilingActionButtons
          filingId={ev.id} filingName={ev.name}
          status={ev.status}
        />
      );
    }
    return null;
  }

  /** Whether this event has a resolved status (attended, cancelled, or filed) */
  function isResolved(ev: CalendarEvent): boolean {
    if (ev.kind === 'filing') {
      const s = ev.status?.toLowerCase();
      return s === 'filed' || s === 'done' || s === 'completed';
    }
    return ev.isAttended || ev.status === 'Cancelled';
  }

  return (
    <div>
      {/* Navigation header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrev}
            className="p-2 max-sm:p-2.5 rounded-lg hover:bg-subtle transition-all duration-150 text-[var(--text-muted)] hover:text-foreground border border-[var(--border-color)] hover:border-[var(--border-hover)]"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goToNext}
            className="p-2 max-sm:p-2.5 rounded-lg hover:bg-subtle transition-all duration-150 text-[var(--text-muted)] hover:text-foreground border border-[var(--border-color)] hover:border-[var(--border-hover)]"
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-foreground ml-1 tracking-tight">{weekLabel}</span>
          {loading && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] ml-2">
              <Loader2 className="w-3 h-3 animate-spin" />
            </span>
          )}
        </div>
        {!isCurrentWeek && (
          <button
            onClick={goToThisWeek}
            className="text-xs text-gold-500 hover:text-gold-400 font-medium px-3 py-1.5 max-sm:min-h-9 rounded-lg hover:bg-gold-50 dark:hover:bg-[rgba(185, 143, 69,0.08)] border border-gold-200 dark:border-gold-500/20 transition-all duration-150 dark:text-gold-400"
          >
            This Week
          </button>
        )}
      </div>

      {/* Calendar grid */}
      <div className={`transition-opacity duration-150 ${loading ? 'opacity-50' : ''}`}>
        {/* Desktop: 7-column grid */}
        <div className="hidden sm:grid sm:grid-cols-7 gap-px bg-[var(--border-color)] rounded-xl overflow-hidden">
          {days.map((d, i) => {
            const dateStr = fmtISO(d);
            const isToday = dateStr === todayStr;
            const dayEvents = byDate.get(dateStr) ?? [];

            return (
              <div
                key={dateStr}
                className={`min-h-[140px] ${isToday ? 'bg-gold-50/40 dark:bg-[rgba(185, 143, 69,0.04)]' : 'bg-card'}`}
              >
                {/* Day header */}
                <div className={`relative px-2.5 py-2 border-b border-[var(--border-color)] ${isToday ? 'bg-gold-50 dark:bg-[rgba(185, 143, 69,0.08)]' : 'bg-subtle'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${isToday ? 'text-gold-600 dark:text-gold-400' : 'text-[var(--text-muted)]'}`}>
                      {DAY_NAMES[i]}
                    </span>
                    <span className={`text-xs font-semibold rounded-full w-6 h-6 flex items-center justify-center ${isToday ? 'bg-gold-500 dark:bg-gold-400 text-white' : 'text-[var(--text-secondary)]'}`}>
                      {d.getDate()}
                    </span>
                  </div>
                  {isToday && (
                    <div className="absolute bottom-0 left-2.5 right-2.5 h-[2px] bg-gradient-to-r from-gold-400 to-transparent rounded-full today-shimmer" />
                  )}
                </div>

                {/* Events */}
                <div className="p-1.5 space-y-1.5">
                  {dayEvents.map((ev) => {
                    const style = kindStyles[ev.kind];
                    const hasAction = ev.kind === 'meeting' || ev.kind === 'hearing' || ev.kind === 'filing';
                    const resolved = isResolved(ev);
                    return (
                      <div key={ev.id} className={`group/card relative rounded-lg overflow-hidden border-l-2 transition-all duration-200 hover:shadow-[var(--shadow-card)] ${style.bg} ${style.border}`}>
                        <button
                          type="button"
                          onClick={() => openPane(KIND_TO_ENTITY[ev.kind], ev.id)}
                          className={`w-full text-left block px-2 py-1.5 text-xs leading-tight transition-colors duration-150 cursor-pointer ${style.bg}`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div className="flex-1 min-w-0">
                              {ev.time && (
                                <p className="text-[10px] font-mono text-[var(--text-muted)] dark:text-[var(--text-secondary)] font-medium">{ev.time}</p>
                              )}
                              <p className="font-semibold text-foreground line-clamp-2">{ev.name}</p>
                              {ev.matterName && (
                                <p className="text-[10px] text-[var(--text-muted)] dark:text-[var(--text-secondary)] truncate mt-0.5">{ev.matterName}</p>
                              )}
                            </div>
                            {/* Always-visible status indicator */}
                            {hasAction && (
                              <span className="shrink-0 mt-0.5">
                                {ev.status === 'Cancelled' ? (
                                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500/20 text-red-500 dark:text-red-400" title="Cancelled">
                                    <X className="w-2.5 h-2.5" />
                                  </span>
                                ) : ev.isAttended ? (
                                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" title="Attended">
                                    <Check className="w-2.5 h-2.5" />
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-[var(--text-muted)]/30" title="Pending">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]/40" />
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                          {ev.type && (
                            <span className={`inline-block mt-0.5 px-1.5 py-px rounded text-[10px] font-semibold ${badgeClass(ev.type)}`}>
                              {ev.type}
                            </span>
                          )}
                        </button>
                        {/* Hover action bar — compact icon buttons.
                            Keep MOUNTED even when resolved so the AddDTRModal
                            (rendered via portal from inside the action button)
                            can finish its lifecycle after marking attended. */}
                        {hasAction && (
                          <div
                            className={
                              resolved
                                ? 'hidden'
                                : 'grid grid-rows-[0fr] group-hover/card:grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out'
                            }
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                          >
                            <div className="overflow-hidden">
                              <div className={`flex items-center justify-end gap-1 px-2 py-1 border-t border-current/5 ${style.bg}`}>
                                {renderActionButton(ev, true)}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile: stacked day list */}
        <div className="sm:hidden space-y-2">
          {days.map((d, i) => {
            const dateStr = fmtISO(d);
            const isToday = dateStr === todayStr;
            const dayEvents = byDate.get(dateStr) ?? [];

            if (dayEvents.length === 0) return null;

            return (
              <div key={dateStr}>
                <div className={`flex items-center gap-2 mb-1 px-1 ${isToday ? 'text-gold-500 dark:text-gold-400' : 'text-[var(--text-secondary)]'}`}>
                  <span className="text-xs font-semibold uppercase">{DAY_NAMES[i]}</span>
                  <span className={`text-xs font-medium ${isToday ? 'bg-gold-500 text-white rounded-full w-6 h-6 flex items-center justify-center' : ''}`}>
                    {d.getDate()}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {d.toLocaleDateString('en-PH', { month: 'short' })}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayEvents.map((ev) => {
                    const style = kindStyles[ev.kind];
                    const hasAction = ev.kind === 'meeting' || ev.kind === 'hearing' || ev.kind === 'filing';
                    const resolved = isResolved(ev);
                    return (
                      <div key={ev.id} className={`rounded-xl overflow-hidden border-l-3 ${style.border} ${style.bg}`}>
                        <button
                          type="button"
                          onClick={() => openPane(KIND_TO_ENTITY[ev.kind], ev.id)}
                          className="w-full text-left block px-3 py-2.5 hover:bg-card-hover transition-all duration-150 cursor-pointer"
                        >
                          <p className="text-sm font-medium text-foreground break-words">{ev.name}</p>
                          {ev.matterName && (
                            <p className="text-[11px] text-[var(--text-muted)] dark:text-[var(--text-secondary)] truncate">{ev.matterName}</p>
                          )}
                          {(ev.time || ev.type) && (
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              {ev.time && (
                                <span className="text-xs font-mono text-[var(--text-muted)] dark:text-[var(--text-secondary)] font-medium whitespace-nowrap">{ev.time}</span>
                              )}
                              {ev.type && (
                                <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${badgeClass(ev.type)}`}>
                                  {ev.type}
                                </span>
                              )}
                            </span>
                          )}
                        </button>
                        {/* Keep MOUNTED when resolved so the portal-rendered
                            AddDTRModal inside the action button can finish
                            its lifecycle after marking attended. */}
                        {hasAction && (
                          <div
                            className={`${resolved ? 'hidden' : 'flex'} items-center justify-end gap-1.5 px-3 py-1.5 border-t border-current/5`}
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                          >
                            {renderActionButton(ev)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {events.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] text-center py-6">No events scheduled this week. Enjoy the breathing room.</p>
          )}
        </div>
      </div>
    </div>
  );
}
