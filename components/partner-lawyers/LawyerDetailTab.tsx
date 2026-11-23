'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ChevronLeft, ChevronRight, Loader2, Calendar, Briefcase,
  Clock, ChevronDown, ChevronUp, BarChart3, CalendarDays, FileText, ChevronsUpDown, Check,
  LayoutGrid, List, TrendingUp, Wallet, Pencil, X as XIcon,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell,
  LineChart, Line, Legend,
} from 'recharts';
import type { NotionMeeting, NotionHearing, NotionFiling } from '@/types/notion';
import type { CalendarDeliverable, CalendarLeave } from '@/app/api/firm-calendar/month/route';
import type { Holiday } from '@/lib/legal/ph-holidays';
import { toDecimal } from '@/lib/dtr-utils';
import { isDateOnly, manilaMonth, manilaToday, toManilaDay, weekRange } from '@/lib/dates';

// ── Types ─────────────────────────────────────────────────────

interface LawyerInfo {
  id: string;
  personId: string;
  name: string;
  initials: string;
  position: string;
  monthlySalary?: number | null;
}

interface CalendarData {
  weekStart: string;
  weekEnd: string;
  deliverables: CalendarDeliverable[];
  meetings: NotionMeeting[];
  hearings: NotionHearing[];
  filings: NotionFiling[];
  holidays: Holiday[];
  leaves: CalendarLeave[];
}

interface MatterItem {
  notion_id: string;
  name: string;
  client_name: string;
  type: string;
  status: string;
}

interface DTREntry {
  id: string;
  remarks: string;
  task: string;
  hours: number;
  minutes: number;
  date: string | null;
  lawyerName: string;
  matterId: string | null;
  matterName: string;
  clientName: string;
}

interface TrendPoint {
  month: string; // YYYY-MM
  hours: number;
  target: number;
}

interface LawyerDetailData {
  lawyer: LawyerInfo;
  calendar: CalendarData;
  matters: { items: MatterItem[]; typeBreakdown: Record<string, number>; total: number };
  dtr: { month: string; entries: DTREntry[] };
  trend: TrendPoint[];
}

// ── Constants ─────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  Litigation: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  Retainer: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Labor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  'Special Project': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Intellectual Property': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  Tax: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  Immigration: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  Incorporation: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  'Post-Incorporation': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  'Corporate Housekeeping': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
};

const TYPE_SEGMENT_COLORS: Record<string, string> = {
  Litigation: 'bg-orange-100 dark:bg-orange-500/70',
  Retainer: 'bg-blue-100 dark:bg-blue-500/70',
  Labor: 'bg-rose-100 dark:bg-rose-500/70',
  'Special Project': 'bg-emerald-100 dark:bg-emerald-500/70',
  'Intellectual Property': 'bg-violet-100 dark:bg-violet-500/70',
  Tax: 'bg-amber-100 dark:bg-amber-500/70',
  Immigration: 'bg-cyan-100 dark:bg-cyan-500/70',
  Incorporation: 'bg-teal-100 dark:bg-teal-500/70',
  'Post-Incorporation': 'bg-sky-100 dark:bg-sky-500/70',
  'Corporate Housekeeping': 'bg-indigo-100 dark:bg-indigo-500/70',
};

const DOT_COLORS: Record<string, string> = {
  meeting: 'bg-blue-400',
  hearing: 'bg-rose-400',
  filing: 'bg-amber-500',
  deadline: 'bg-orange-400',
  review: 'bg-violet-400',
  leave: 'bg-cyan-400',
  holiday: 'bg-emerald-400',
};

const TYPE_LABELS: Record<string, string> = {
  meeting: 'Meeting',
  hearing: 'Hearing',
  filing: 'Filing',
  deadline: 'Deadline',
  review: 'Review',
  leave: 'Leave',
  holiday: 'Holiday',
};

const LEGEND_ITEMS: { key: string; label: string; color: string; ring: string }[] = [
  { key: 'meeting', label: 'Meetings', color: 'bg-blue-400', ring: 'ring-blue-400/20' },
  { key: 'hearing', label: 'Hearings', color: 'bg-rose-400', ring: 'ring-rose-400/20' },
  { key: 'filing', label: 'Filings', color: 'bg-amber-500', ring: 'ring-amber-500/20' },
  { key: 'deadline', label: 'Deadlines', color: 'bg-orange-400', ring: 'ring-orange-400/20' },
  { key: 'review', label: 'Reviews', color: 'bg-violet-400', ring: 'ring-violet-400/20' },
  { key: 'leave', label: 'Leaves', color: 'bg-cyan-400', ring: 'ring-cyan-400/20' },
  { key: 'holiday', label: 'Holidays', color: 'bg-emerald-400', ring: 'ring-emerald-400/20' },
];

const ALL_FILTER_KEYS = LEGEND_ITEMS.map((i) => i.key);

const GROUP_ORDER = ['review', 'deadline', 'filing', 'hearing', 'meeting', 'leave', 'holiday'];

const PIE_COLORS = ['#fbbf24', '#d97706', '#78716c', '#f59e0b', '#a8a29e', '#92400e', '#e7e5e4'];

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function pad(n: number) { return n.toString().padStart(2, '0'); }

// ── Main Component ────────────────────────────────────────────

interface LawyerOption {
  id: string;
  personId: string;
  name: string;
  initials: string;
  position: string;
}

interface Props {
  personId: string;
  lawyers: LawyerOption[];
  onSwitchLawyer: (personId: string, initials: string) => void;
  canEditSalary?: boolean;
}

type DetailSubTab = 'overview' | 'compensation';

export default function LawyerDetailTab({
  personId,
  lawyers,
  onSwitchLawyer,
  canEditSalary = false,
}: Props) {
  const [subTab, setSubTab] = useState<DetailSubTab>('overview');
  const [weekStart, setWeekStart] = useState(() => weekRange().start);
  const [dtrMonth, setDtrMonth] = useState(() => manilaMonth());

  const url = `/api/partner/lawyers/${personId}?weekStart=${weekStart}&month=${dtrMonth}`;
  const { data, isLoading, mutate } = useSWR<LawyerDetailData>(url, fetcher, { keepPreviousData: true });

  const goToPrevWeek = useCallback(() => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() - 7);
    setWeekStart(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }, [weekStart]);

  const goToNextWeek = useCallback(() => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    setWeekStart(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }, [weekStart]);

  const goToThisWeek = useCallback(() => {
    setWeekStart(weekRange().start);
  }, []);

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-gold-500 animate-spin dark:text-gold-400" />
      </div>
    );
  }

  if (!data?.lawyer) return null;

  const { lawyer, calendar, matters, dtr } = data;

  return (
    <div className="space-y-8 animate-fade-up">
      {/* Lawyer header with dropdown */}
      <LawyerSwitcher
        current={lawyer}
        lawyers={lawyers}
        onSwitch={onSwitchLawyer}
        isLoading={isLoading}
      />

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800/50 rounded-lg p-1 w-fit">
        {([
          { key: 'overview', label: 'Overview', icon: LayoutGrid },
          { key: 'compensation', label: 'Compensation', icon: Wallet },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = subTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all cursor-pointer ${
                active
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === 'compensation' ? (
        <CompensationSection
          lawyer={lawyer}
          canEdit={canEditSalary}
          onSaved={() => mutate()}
        />
      ) : (
        <OverviewSections
          calendar={calendar}
          matters={matters}
          dtr={dtr}
          dtrMonth={dtrMonth}
          setDtrMonth={setDtrMonth}
          trend={data.trend}
          goToPrevWeek={goToPrevWeek}
          goToNextWeek={goToNextWeek}
          goToThisWeek={goToThisWeek}
        />
      )}
    </div>
  );
}

function OverviewSections({
  calendar,
  matters,
  dtr,
  dtrMonth,
  setDtrMonth,
  trend,
  goToPrevWeek,
  goToNextWeek,
  goToThisWeek,
}: {
  calendar: CalendarData;
  matters: LawyerDetailData['matters'];
  dtr: LawyerDetailData['dtr'];
  dtrMonth: string;
  setDtrMonth: (m: string) => void;
  trend: TrendPoint[];
  goToPrevWeek: () => void;
  goToNextWeek: () => void;
  goToThisWeek: () => void;
}) {
  return (
    <div className="space-y-8">
      {/* ── Weekly Calendar ──────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gold-600 dark:text-gold-400" />
            <h3 className="font-serif text-lg font-semibold text-stone-800 dark:text-stone-200">
              Weekly Calendar
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={goToPrevWeek} className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 dark:hover:text-stone-300 transition-all cursor-pointer dark:text-stone-500">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-stone-600 dark:text-stone-400 min-w-[180px] text-center">
              {formatWeekRange(calendar.weekStart, calendar.weekEnd)}
            </span>
            <button type="button" onClick={goToNextWeek} className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 dark:hover:text-stone-300 transition-all cursor-pointer dark:text-stone-500">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button type="button" onClick={goToThisWeek} className="ml-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gold-200/60 dark:border-gold-700/40 text-gold-700 dark:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-900/15 transition-all cursor-pointer">
              This Week
            </button>
          </div>
        </div>
        <WeeklyCalendarGrid calendar={calendar} />
      </section>

      {/* ── Active Matters ────────────────────────────────────── */}
      <section>
        <ActiveMattersSection matters={matters} />
      </section>

      {/* ── 6-Month Trend ─────────────────────────────────────── */}
      {trend && trend.length > 0 && (
        <section>
          <TrendSection trend={trend} />
        </section>
      )}

      {/* ── DTR Analytics ─────────────────────────────────────── */}
      <section>
        <DTRSection dtr={dtr} dtrMonth={dtrMonth} setDtrMonth={setDtrMonth} />
      </section>
    </div>
  );
}

// ── Compensation Section ─────────────────────────────────────

function formatPHP(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return 'Not set';
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

function CompensationSection({
  lawyer,
  canEdit,
}: {
  lawyer: LawyerInfo;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const currentSalary = lawyer.monthlySalary;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4 text-gold-600 dark:text-gold-400" />
        <h3 className="font-serif text-lg font-semibold text-stone-800 dark:text-stone-200">
          Compensation
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Monthly salary card (read-only — edit in /admin/users) */}
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Monthly salary
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
            {formatPHP(currentSalary)}
          </p>
          <p className="mt-3 text-[11px] text-stone-400 dark:text-stone-500">
            {canEdit ? (
              <>
                Edit in{' '}
                <Link
                  href="/admin/users"
                  className="underline hover:text-stone-600 dark:hover:text-stone-300"
                >
                  User Management
                </Link>
                .
              </>
            ) : (
              'Editable by the Managing Partner in User Management.'
            )}
          </p>
        </div>

      </div>
    </section>
  );
}

// ── Lawyer Switcher Dropdown ──────────────────────────────────

const POSITION_ORDER: Record<string, number> = {
  'Founding Partner': 0, 'Managing Partner': 1, 'Monitoring Partner': 2, 'Partner': 3,
  'Of Counsel': 4, 'Senior Associate': 5, 'Mid-level Associate': 6,
  'Junior Associate': 7, 'Underbar Associate': 8,
};

function LawyerSwitcher({
  current,
  lawyers,
  onSwitch,
  isLoading,
}: {
  current: LawyerInfo;
  lawyers: LawyerOption[];
  onSwitch: (personId: string, initials: string) => void;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const sorted = useMemo(() =>
    [...lawyers].sort((a, b) => (POSITION_ORDER[a.position] ?? 99) - (POSITION_ORDER[b.position] ?? 99)),
    [lawyers],
  );

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((l) =>
      l.name.toLowerCase().includes(q) || l.initials.toLowerCase().includes(q) || l.position.toLowerCase().includes(q),
    );
  }, [sorted, search]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (!open) setSearch('');
          setOpen(!open);
        }}
        className="flex items-center gap-3 group cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/30 rounded-xl px-3 py-2 -mx-3 -my-2 transition-colors"
      >
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
          {current.initials}
        </div>
        <div className="text-left">
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">{current.name}</h2>
            <ChevronsUpDown className="w-4 h-4 text-stone-400 group-hover:text-gold-500 transition-colors dark:text-stone-500" />
            {isLoading && <Loader2 className="w-4 h-4 text-gold-500 animate-spin dark:text-gold-400" />}
          </div>
          <p className="text-xs text-stone-400 dark:text-stone-500">{current.position}</p>
        </div>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in">
          {/* Search */}
          <div className="p-2 border-b border-[var(--border-color)]">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lawyer..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-transparent text-stone-800 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 dark:placeholder:text-stone-500"
            />
          </div>
          {/* List */}
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.map((l) => {
              const isActive = l.personId === current.personId;
              return (
                <button
                  key={l.personId}
                  type="button"
                  onClick={() => {
                    onSwitch(l.personId, l.initials);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-gold-50 dark:bg-gold-900/15'
                      : 'hover:bg-stone-50 dark:hover:bg-stone-800/30'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    isActive
                      ? 'bg-gradient-to-br from-gold-400 to-gold-600 text-white'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                  }`}>
                    {l.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${isActive ? 'text-gold-700 dark:text-gold-400' : 'text-stone-800 dark:text-stone-200'}`}>
                      {l.name}
                    </p>
                    <p className="text-[11px] text-stone-400 dark:text-stone-500">{l.position}</p>
                  </div>
                  {isActive && <Check className="w-4 h-4 text-gold-500 shrink-0 dark:text-gold-400" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-stone-400 py-4 dark:text-stone-500">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Weekly Calendar Grid ──────────────────────────────────────

interface DayEntry {
  type: string;
  name: string;
  matter?: string;
  time?: string;
}

function getReviewLabel(reviewerIndex?: number, reviewerCount?: number): string {
  if (reviewerIndex == null || !reviewerCount || reviewerCount <= 0) return 'Review';
  if (reviewerCount === 1) return 'Review';
  if (reviewerIndex === 0) return 'Initial Review';
  if (reviewerIndex === reviewerCount - 1) return 'Final Review';
  return ['2nd', '3rd', '4th'][reviewerIndex - 1] + ' Review';
}

function WeeklyCalendarGrid({ calendar }: { calendar: CalendarData }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [enabledFilters, setEnabledFilters] = useState<Set<string>>(() => new Set(ALL_FILTER_KEYS));
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFiltered = enabledFilters.size !== ALL_FILTER_KEYS.length;
  const filterKey = useMemo(() => Array.from(enabledFilters).sort().join('|'), [enabledFilters]);

  const toggleFilter = useCallback((key: string) => {
    setEnabledFilters((prev) => {
      if (prev.size === ALL_FILTER_KEYS.length) return new Set([key]);
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        if (next.size === 0) return new Set(ALL_FILTER_KEYS);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => setEnabledFilters(new Set(ALL_FILTER_KEYS)), []);

  const isTypeEnabled = useCallback((type: string) => enabledFilters.has(type), [enabledFilters]);

  const todayStr = useMemo(() => manilaToday(), []);

  const days = useMemo(() => {
    const result: { date: string; dayName: string; dayNum: number; isToday: boolean; isWeekend: boolean }[] = [];
    const start = new Date(calendar.weekStart + 'T00:00:00');
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      result.push({ date: dateStr, dayName: DAY_NAMES[i], dayNum: d.getDate(), isToday: dateStr === todayStr, isWeekend: i >= 5 });
    }
    return result;
  }, [calendar.weekStart, todayStr]);

  // Build date → dot types (filtered)
  const dateDots = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (date: string | null, type: string) => {
      if (!date || !isTypeEnabled(type)) return;
      const d = toManilaDay(date);
      if (!map.has(d)) map.set(d, new Set());
      map.get(d)!.add(type);
    };

    for (const m of calendar.meetings) add(m.date, 'meeting');
    for (const h of calendar.hearings) add(h.date, 'hearing');
    for (const f of calendar.filings) add(f.date, 'filing');
    for (const d of calendar.deliverables) add(d.date, d.dateType === 'review' ? 'review' : 'deadline');
    for (const l of calendar.leaves) {
      const ls = new Date(l.periodStart + 'T00:00:00');
      const le = new Date(l.periodEnd + 'T00:00:00');
      for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) {
        add(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, 'leave');
      }
    }
    for (const h of calendar.holidays) add(h.date, 'holiday');
    return map;
  }, [calendar, isTypeEnabled]);

  // Build date → detailed entries (filtered)
  const dateDetails = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    const add = (date: string | null, entry: DayEntry) => {
      if (!date || !isTypeEnabled(entry.type)) return;
      const d = toManilaDay(date);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(entry);
    };

    const fmtTime = (iso: string | null): string | undefined => {
      if (!iso || !iso.includes('T') || isDateOnly(iso)) return undefined;
      try { return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }); }
      catch { return undefined; }
    };

    for (const m of calendar.meetings) add(m.date, { type: 'meeting', name: m.name, matter: m.matter || undefined, time: fmtTime(m.date) });
    for (const h of calendar.hearings) add(h.date, { type: 'hearing', name: h.name, matter: h.matter || undefined, time: fmtTime(h.date) });
    for (const f of calendar.filings) add(f.date, { type: 'filing', name: f.name, matter: f.matter || undefined });
    for (const d of calendar.deliverables) {
      const subLabel = d.dateType === 'deadline' ? 'Deadline' : getReviewLabel(d.reviewerIndex, d.reviewerCount);
      add(d.date, { type: d.dateType === 'review' ? 'review' : 'deadline', name: d.name, matter: d.matter ? `${subLabel} · ${d.matter}` : subLabel });
    }
    for (const l of calendar.leaves) {
      const ls = new Date(l.periodStart + 'T00:00:00');
      const le = new Date(l.periodEnd + 'T00:00:00');
      for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) {
        add(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, { type: 'leave', name: `${l.leaveType} Leave`, matter: l.reason || undefined });
      }
    }
    for (const h of calendar.holidays) add(h.date, { type: 'holiday', name: h.name });
    return map;
  }, [calendar, isTypeEnabled]);

  const handleMouseEnter = useCallback((dateStr: string) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setHoveredDate(dateStr), 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = null;
    setHoveredDate(null);
  }, []);

  const totalEvents = useMemo(() => {
    let count = 0;
    for (const entries of dateDetails.values()) count += entries.length;
    return count;
  }, [dateDetails]);

  const selectedEntries = selectedDate ? dateDetails.get(selectedDate) ?? [] : [];

  return (
    <div className="space-y-3">
      {/* View toggle + legend filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Clickable legend filters */}
        <div className="flex items-center gap-1 flex-wrap">
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

        {/* Dots / Detail toggle */}
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
          <span className="text-[10px] text-stone-400 dark:text-stone-500">
            {totalEvents} event{totalEvents !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-[var(--shadow-card)]">
        {/* Day headers */}
        <div className="grid grid-cols-7 px-2 pt-3 pb-2">
          {days.map((day) => (
            <div
              key={day.date}
              className={`py-2 text-center text-[11px] font-semibold uppercase tracking-widest ${
                day.isWeekend ? 'text-stone-300 dark:text-stone-600' : 'text-stone-400 dark:text-stone-500'
              }`}
            >
              {day.dayName}
            </div>
          ))}
        </div>

        {/* Date cells */}
        <div className="px-2 pb-3">
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, di) => {
              const dots = dateDots.get(day.date);
              const isHoliday = dots?.has('holiday');
              const dotTypes = dots ? Array.from(dots).filter(t => t !== 'holiday') : [];
              const isSelected = day.date === selectedDate;
              const isHovered = day.date === hoveredDate;
              const entries = dateDetails.get(day.date);
              const hasEntries = entries && entries.length > 0;

              return (
                <div
                  key={day.date}
                  className="relative"
                  onMouseEnter={() => hasEntries && !showDetails && handleMouseEnter(day.date)}
                  onMouseLeave={handleMouseLeave}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedDate(day.date === selectedDate ? null : day.date)}
                    className={`
                      relative flex flex-col rounded-xl w-full
                      ${showDetails ? 'items-start min-h-[100px] sm:min-h-[120px] py-1.5 px-1.5' : 'items-center min-h-[72px] sm:min-h-[80px] py-2 px-1'}
                      transition-all duration-200 ease-out cursor-pointer active:scale-[0.98]
                      ${!isSelected ? 'hover:bg-stone-50 dark:hover:bg-stone-800/40 hover:shadow-sm' : ''}
                      ${isSelected ? 'bg-gold-50/80 dark:bg-gold-900/20 ring-1 ring-inset ring-gold-300/60 dark:ring-gold-600/40 shadow-sm' : ''}
                      ${isHoliday && !isSelected ? 'bg-emerald-50/40 dark:bg-emerald-900/8' : ''}
                    `}
                  >
                    <span
                      className={`
                        text-sm font-medium leading-none w-7 h-7 flex items-center justify-center rounded-full transition-all duration-200
                        ${showDetails ? 'self-end' : ''}
                        ${day.isToday
                          ? 'bg-gold-500 text-white font-bold shadow-md shadow-gold-400/30 dark:shadow-gold-600/20'
                          : isSelected
                            ? 'text-gold-800 dark:text-gold-300 font-semibold'
                            : day.isWeekend
                              ? 'text-stone-400 dark:text-stone-500'
                              : 'text-stone-700 dark:text-stone-300'
                        }
                      `}
                    >
                      {day.dayNum}
                    </span>

                    {showDetails && entries && entries.length > 0 ? (
                      <DayDetailGroups entries={entries} filterKey={filterKey} />
                    ) : (
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
                  </button>

                  {/* Hover tooltip — only in dots mode */}
                  {!showDetails && isHovered && !isSelected && entries && entries.length > 0 && (
                    <WeeklyTooltip entries={entries} column={di} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected date entries */}
      {selectedDate && (
        <div className="animate-fade-in">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-gradient-to-r from-gold-200/60 to-transparent dark:from-gold-800/30" />
            <span className="text-sm font-medium text-gold-700 dark:text-gold-400 tracking-wide">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-PH', {
                weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Manila',
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

          {selectedEntries.length === 0 ? (
            <p className="text-center text-sm text-stone-400 py-4 dark:text-stone-500">No entries</p>
          ) : (
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-4 space-y-2.5">
              {(() => {
                const grouped = new Map<string, DayEntry[]>();
                for (const e of selectedEntries) {
                  if (!grouped.has(e.type)) grouped.set(e.type, []);
                  grouped.get(e.type)!.push(e);
                }
                const sorted = new Map<string, DayEntry[]>();
                for (const type of GROUP_ORDER) { if (grouped.has(type)) sorted.set(type, grouped.get(type)!); }
                for (const [type, items] of grouped) { if (!sorted.has(type)) sorted.set(type, items); }
                return Array.from(sorted.entries()).map(([type, items]) => (
                  <div key={type}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[type] ?? 'bg-stone-300'}`} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                        {TYPE_LABELS[type] ?? type}{items.length > 1 ? `s (${items.length})` : ''}
                      </span>
                    </div>
                    <div className="space-y-1 pl-3">
                      {items.map((entry, idx) => (
                        <div key={idx}>
                          <p className="text-sm font-medium text-stone-700 dark:text-stone-300 leading-tight">
                            {entry.time && <span className="font-mono text-stone-400 dark:text-stone-500 text-xs">{entry.time} </span>}
                            {entry.name}
                          </p>
                          {entry.matter && (
                            <p className="text-xs text-stone-400 dark:text-stone-500 leading-tight">{entry.matter}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DayDetailGroups({ entries, filterKey }: { entries: DayEntry[]; filterKey: string }) {
  const grouped = useMemo(() => {
    const sorted = new Map<string, DayEntry[]>();
    const map = new Map<string, DayEntry[]>();
    for (const e of entries) {
      if (!map.has(e.type)) map.set(e.type, []);
      map.get(e.type)!.push(e);
    }
    for (const type of GROUP_ORDER) { if (map.has(type)) sorted.set(type, map.get(type)!); }
    for (const [type, items] of map) { if (!sorted.has(type)) sorted.set(type, items); }
    return sorted;
  }, [entries]);

  return (
    <div className="w-full mt-0.5 space-y-1 text-left" key={filterKey}>
      {Array.from(grouped.entries()).map(([type, items]) => (
        <div key={type}>
          <div className="flex items-center gap-1 mb-[1px]">
            <span className={`w-[5px] h-[5px] rounded-full ${DOT_COLORS[type] ?? 'bg-stone-300'}`} />
            <span className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {TYPE_LABELS[type] ?? type}{items.length > 1 ? `s (${items.length})` : ''}
            </span>
          </div>
          <div className="space-y-[1px] pl-2.5">
            {items.map((entry, idx) => (
              <div key={idx} className="min-w-0">
                <p className="text-[9px] sm:text-[10px] font-medium text-stone-700 dark:text-stone-300 leading-tight">
                  {entry.time && <span className="font-mono text-stone-400 dark:text-stone-500">{entry.time} </span>}
                  {entry.name}
                </p>
                {entry.matter && (
                  <p className="text-[8px] sm:text-[9px] text-stone-400 dark:text-stone-500 leading-tight">{entry.matter}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WeeklyTooltip({ entries, column }: { entries: DayEntry[]; column: number }) {
  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of entries) {
      if (!map.has(e.type)) map.set(e.type, []);
      map.get(e.type)!.push(e.name);
    }
    return map;
  }, [entries]);

  const alignClass = column <= 1 ? 'left-0' : column >= 5 ? 'right-0' : 'left-1/2 -translate-x-1/2';

  return (
    <div className={`absolute top-full mt-1 z-50 ${alignClass} w-56 max-h-48 overflow-y-auto bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl shadow-[var(--shadow-elevated)] p-3 animate-fade-in`}>
      <div className="space-y-2">
        {Array.from(grouped.entries()).map(([type, names]) => (
          <div key={type}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[type] ?? 'bg-stone-300'}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                {TYPE_LABELS[type] ?? type}{names.length > 1 ? `s (${names.length})` : ''}
              </span>
            </div>
            <div className="space-y-0.5 pl-3">
              {names.slice(0, 3).map((name, i) => (
                <p key={i} className="text-xs text-stone-600 dark:text-stone-400 truncate leading-relaxed">{name}</p>
              ))}
              {names.length > 3 && (
                <p className="text-[10px] text-stone-400 dark:text-stone-500 italic">+{names.length - 3} more</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-2 pt-2 border-t border-[var(--border-color)] text-center">Click to view details</p>
    </div>
  );
}

// ── Active Matters Section ────────────────────────────────────

function ActiveMattersSection({ matters }: { matters: LawyerDetailData['matters'] }) {
  const [showList, setShowList] = useState(false);

  const sortedTypes = useMemo(() =>
    Object.entries(matters.typeBreakdown).sort(([, a], [, b]) => b - a),
    [matters.typeBreakdown],
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Briefcase className="w-4 h-4 text-gold-600 dark:text-gold-400" />
        <h3 className="font-serif text-lg font-semibold text-stone-800 dark:text-stone-200">
          Active Matters
        </h3>
        <span className="text-xs font-medium text-stone-400 dark:text-stone-500 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full">
          {matters.total}
        </span>
        {matters.total > 0 && (
          <button
            type="button"
            onClick={() => setShowList((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 text-xs text-stone-500 hover:text-gold-600 dark:hover:text-gold-400 cursor-pointer transition-colors dark:text-stone-400"
          >
            {showList ? 'Hide list' : 'Show list'}
            {showList
              ? <ChevronUp className="w-3.5 h-3.5" />
              : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Type distribution bar — always visible */}
        {sortedTypes.length > 0 && (
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-4">
            <p className="text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-3">
              Type Distribution
            </p>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-6 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden flex">
                {sortedTypes.map(([type, count]) => {
                  const pct = (count / matters.total) * 100;
                  const colorClass = TYPE_SEGMENT_COLORS[type] ?? 'bg-stone-300 dark:bg-stone-600';
                  return (
                    <div
                      key={type}
                      className={`h-full ${colorClass} transition-all duration-300`}
                      style={{ width: `${pct}%` }}
                      title={`${type}: ${count}`}
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {sortedTypes.map(([type, count]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${TYPE_COLORS[type] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
                    {type}
                  </span>
                  <span className="text-xs font-bold text-stone-700 dark:text-stone-300 tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Matters list — collapsed by default */}
        {showList && (
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden animate-fade-in">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-color)]">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Matter</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Client</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {matters.items.map((m) => (
                    <tr key={m.notion_id} className="border-b border-stone-100/50 dark:border-stone-800/50 hover:bg-stone-50/50 dark:hover:bg-stone-800/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-stone-800 dark:text-stone-200 line-clamp-1">{m.name}</span>
                      </td>
                      <td className="px-4 py-2.5 text-stone-600 dark:text-stone-400 whitespace-nowrap">{m.client_name}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${TYPE_COLORS[m.type] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
                          {m.type || 'Other'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {matters.items.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-sm text-stone-400 dark:text-stone-500">No active matters</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Trend Section (6-month hours vs. target) ─────────────────

function TrendSection({ trend }: { trend: TrendPoint[] }) {
  const chartData = trend.map((p) => {
    const [y, m] = p.month.split('-');
    const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
    return {
      label,
      month: p.month,
      hours: p.hours,
      target: p.target,
      ratio: p.target > 0 ? p.hours / p.target : 0,
    };
  });

  const target = trend[0]?.target ?? 0;
  const avgHours = trend.reduce((a, p) => a + p.hours, 0) / Math.max(1, trend.length);
  const latest = trend[trend.length - 1];
  const first = trend[0];
  const delta = latest && first && first.hours > 0
    ? ((latest.hours - first.hours) / first.hours) * 100
    : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-gold-600 dark:text-gold-400" />
        <h3 className="font-serif text-lg font-semibold text-stone-800 dark:text-stone-200">
          6-Month Hours Trend
        </h3>
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-4">
        {/* Summary row */}
        <div className="flex items-baseline gap-5 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-stone-400 dark:text-stone-500">Avg / Month</div>
            <div className="font-serif text-2xl font-bold tabular-nums text-stone-800 dark:text-stone-100">
              {avgHours.toFixed(1)}
              <span className="text-xs font-normal text-stone-400 ml-1 dark:text-stone-500">/ {target} target</span>
            </div>
          </div>
          {delta !== null && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-stone-400 dark:text-stone-500">6-Month Change</div>
              <div className={`text-lg font-bold tabular-nums ${delta > 10 ? 'text-emerald-500 dark:text-emerald-400' : delta < -10 ? 'text-red-500 dark:text-red-400' : 'text-stone-500 dark:text-stone-400'}`}>
                {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
              </div>
            </div>
          )}
          <div className="ml-auto text-[11px] text-stone-400 dark:text-stone-500">
            Target: {target}h/mo at {latest ? trend.length : 0}-month baseline
          </div>
        </div>

        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#78716c' }}
                axisLine={{ stroke: 'var(--border-color)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#78716c' }}
                axisLine={{ stroke: 'var(--border-color)' }}
                tickLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value, name) => {
                  const n = typeof value === 'number' ? value : Number(value);
                  if (name === 'hours') return [`${n.toFixed(1)}h`, 'Hours'];
                  if (name === 'target') return [`${n}h`, 'Target'];
                  return [n, name];
                }}
              />
              <Legend
                iconSize={10}
                wrapperStyle={{ fontSize: 11 }}
              />
              {target > 0 && (
                <ReferenceLine
                  y={target}
                  stroke="#d97706"
                  strokeDasharray="4 4"
                  label={{ value: 'Target', fontSize: 10, fill: '#d97706', position: 'insideTopRight' }}
                />
              )}
              <Line
                type="monotone"
                dataKey="hours"
                name="Hours"
                stroke="#d97706"
                strokeWidth={2}
                dot={{ r: 4, fill: '#d97706' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── DTR Section ───────────────────────────────────────────────

function DTRSection({
  dtr,
  dtrMonth,
  setDtrMonth,
}: {
  dtr: LawyerDetailData['dtr'];
  dtrMonth: string;
  setDtrMonth: (m: string) => void;
}) {
  const { totalHours, workingDays, avgHoursPerDay, dailyData, taskData } = useMemo(() => {
    let total = 0;
    const daysWorked = new Set<string>();
    const taskMap: Record<string, number> = {};
    const dailyMap: Record<string, number> = {};

    for (const e of dtr.entries) {
      const dec = toDecimal(e.hours, e.minutes);
      total += dec;
      if (e.date) {
        daysWorked.add(e.date);
        dailyMap[e.date] = (dailyMap[e.date] ?? 0) + dec;
      }
      const taskKey = e.task || 'Unspecified';
      taskMap[taskKey] = (taskMap[taskKey] ?? 0) + dec;
    }

    const wDays = daysWorked.size;
    const avg = wDays > 0 ? total / wDays : 0;

    const [yearStr, monthStr] = dtrMonth.split('-');
    const year = parseInt(yearStr);
    const mon = parseInt(monthStr);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const daily = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateStr = `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`;
      return { day, date: dateStr, hours: dailyMap[dateStr] ?? 0 };
    });

    const tasks = Object.entries(taskMap)
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);

    return { totalHours: total, workingDays: wDays, avgHoursPerDay: avg, dailyData: daily, taskData: tasks };
  }, [dtr, dtrMonth]);

  const goToPrevMonth = useCallback(() => {
    const [y, m] = dtrMonth.split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
    setDtrMonth(prev);
  }, [dtrMonth, setDtrMonth]);

  const goToNextMonth = useCallback(() => {
    const [y, m] = dtrMonth.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
    setDtrMonth(next);
  }, [dtrMonth, setDtrMonth]);

  const monthLabel = useMemo(() => {
    const [y, m] = dtrMonth.split('-').map(Number);
    return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [dtrMonth]);

  // Grouped by task for donut
  const MAX_SLICES = 6;
  const chartData = useMemo(() => {
    if (taskData.length <= MAX_SLICES) return taskData;
    const top = taskData.slice(0, MAX_SLICES - 1);
    const rest = taskData.slice(MAX_SLICES - 1);
    const otherHours = rest.reduce((sum, d) => sum + d.hours, 0);
    return [...top, { name: 'Other', hours: otherHours }];
  }, [taskData]);

  const maxHours = Math.max(...dailyData.map((d) => d.hours), 8);

  const stats = [
    { key: 'hours', label: 'Total Hours', icon: Clock, value: totalHours.toFixed(1), color: 'text-gold-500 dark:text-gold-400', bg: 'bg-gold-50 dark:bg-gold-500/10' },
    { key: 'days', label: 'Working Days', icon: CalendarDays, value: String(workingDays), color: 'text-stone-500 dark:text-stone-400', bg: 'bg-stone-50 dark:bg-stone-800' },
    { key: 'avg', label: 'Avg Hours / Day', icon: BarChart3, value: avgHoursPerDay.toFixed(1), color: 'text-gold-600 dark:text-gold-400', bg: 'bg-gold-50/60 dark:bg-gold-500/10' },
    { key: 'entries', label: 'Total Entries', icon: FileText, value: String(dtr.entries.length), color: 'text-stone-400 dark:text-stone-500', bg: 'bg-stone-50 dark:bg-stone-800' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gold-600 dark:text-gold-400" />
          <h3 className="font-serif text-lg font-semibold text-stone-800 dark:text-stone-200">
            DTR Analytics
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={goToPrevMonth} className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 dark:hover:text-stone-300 transition-all cursor-pointer dark:text-stone-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-stone-600 dark:text-stone-400 min-w-[140px] text-center">
            {monthLabel}
          </span>
          <button type="button" onClick={goToNextMonth} className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 dark:hover:text-stone-300 transition-all cursor-pointer dark:text-stone-500">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.key} className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`${s.bg} rounded-lg p-1.5`}>
                  <Icon className={`w-3.5 h-3.5 ${s.color}`} />
                </div>
                <span className="text-[10px] font-medium text-stone-400 uppercase tracking-wider dark:text-stone-500">{s.label}</span>
              </div>
              <p className="text-xl font-bold text-foreground tabular-nums">{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily hours */}
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-4">
          <h4 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-4">Daily Hours</h4>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#a8a29e' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} interval={dailyData.length > 20 ? 1 : 0} />
                <YAxis tick={{ fontSize: 11, fill: '#a8a29e' }} tickLine={false} axisLine={false} domain={[0, Math.ceil(maxHours + 1)]} allowDecimals={false} />
                <Tooltip content={<DailyTooltip />} cursor={{ fill: '#fef3c7', opacity: 0.3 }} />
                <ReferenceLine y={8} stroke="#d6d3d1" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: '8h', position: 'insideTopRight', fill: '#a8a29e', fontSize: 10 }} />
                <Bar dataKey="hours" fill="#fbbf24" radius={[3, 3, 0, 0]} maxBarSize={20} activeBar={{ fill: '#f59e0b' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Task breakdown */}
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-4">
          <h4 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-4">Hours by Task</h4>
          {chartData.length === 0 || totalHours === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">No data</div>
          ) : (
            <>
              <div className="h-48 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartData} cx="50%" cy="45%" innerRadius="55%" outerRadius="80%" paddingAngle={2} dataKey="hours" nameKey="name" stroke="none">
                      {chartData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<TaskTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: '10%' }}>
                  <div className="text-center">
                    <p className="text-lg font-bold text-stone-800 dark:text-stone-200 tabular-nums">{totalHours.toFixed(1)}</p>
                    <p className="text-[9px] text-stone-400 uppercase tracking-wider dark:text-stone-500">hours</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
                {chartData.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-[10px] text-stone-500 dark:text-stone-400">{item.name}</span>
                    <span className="text-[10px] text-stone-400 tabular-nums dark:text-stone-500">({((item.hours / totalHours) * 100).toFixed(0)}%)</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* DTR entries table */}
      {dtr.entries.length > 0 && (
        <div className="mt-4 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Date</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Task</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Hours</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Remarks</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Matter</th>
                </tr>
              </thead>
              <tbody>
                {dtr.entries.map((e) => (
                  <tr key={e.id} className="border-b border-stone-100/50 dark:border-stone-800/50 hover:bg-stone-50/50 dark:hover:bg-stone-800/20 transition-colors">
                    <td className="px-4 py-2 text-stone-600 dark:text-stone-400 whitespace-nowrap tabular-nums">
                      {e.date ? new Date(e.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-2 text-stone-700 dark:text-stone-300 font-medium">{e.task || '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold text-stone-800 dark:text-stone-200 tabular-nums">
                      {(e.hours + e.minutes / 60).toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-stone-500 dark:text-stone-400 max-w-[200px] truncate">{e.remarks || '—'}</td>
                    <td className="px-4 py-2 text-stone-500 dark:text-stone-400 max-w-[180px] truncate">{e.matterName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tooltips ──────────────────────────────────────────────────

function DailyTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: { date: string; hours: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const { date, hours } = payload[0].payload;
  const label = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-medium text-stone-600 dark:text-stone-400 text-xs">{label}</p>
      <p className="text-gold-600 font-semibold tabular-nums mt-0.5 dark:text-gold-400">{hours.toFixed(1)} hrs</p>
    </div>
  );
}

function TaskTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: { name: string; hours: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const { name, hours } = payload[0].payload;
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-medium text-stone-600 dark:text-stone-400 text-xs">{name}</p>
      <p className="text-gold-600 font-semibold tabular-nums mt-0.5 dark:text-gold-400">{hours.toFixed(1)}h</p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

function formatWeekRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sMonth = s.toLocaleDateString('en-US', { month: 'short' });
  const eMonth = e.toLocaleDateString('en-US', { month: 'short' });
  if (sMonth === eMonth) {
    return `${sMonth} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}, ${e.getFullYear()}`;
}
