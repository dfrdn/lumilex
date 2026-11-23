'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  BarChart3,
  Clock,
  FileText,
  AlertCircle,
  Scale,
  TrendingUp,
  Award,
  Target,
  Users,
  Briefcase,
  DollarSign,
  Activity,
  Timer,
  Table,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Legend,
  type BarRectangleItem,
} from 'recharts';
import { UNASSIGNED_MATTER_TYPE } from '@/lib/queries/partner-analytics';
import type {
  MonthlyDTRAggregate,
  DeliverableSnapshot,
  MonthlyHearingFilingAggregate,
  MatterDistribution,
  CurrentMonthSummary,
  CaseOutcomeStats,
  RevenueProjection,
  TurnaroundStats,
  LawyerUtilization,
} from '@/lib/queries/partner-analytics';
import type { BillingEfficiency } from '@/lib/queries/billing-efficiency';

import PeriodSelector from './PeriodSelector';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { manilaMonthIndex } from '@/lib/dates';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pesoFmt = new Intl.NumberFormat('en-PH');

// ── Count-up animation hook ───────────────────────────────────────

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return value;
}

// ── Props ──────────────────────────────────────────────────────────

interface Props {
  year: number;
  currentYear: number;
  dtrAggregates: MonthlyDTRAggregate[];
  deliverableSnapshot: DeliverableSnapshot;
  hearingFilingAggregates: MonthlyHearingFilingAggregate[];
  matterDistribution: MatterDistribution;
  currentMonthSummary: CurrentMonthSummary;
  caseOutcomes: CaseOutcomeStats;
  compare: boolean;
  revenueData: RevenueProjection;
  turnaroundStats: TurnaroundStats;
  utilizationData: LawyerUtilization;
  billingEfficiencyData: BillingEfficiency;
  prevYearDTR?: MonthlyDTRAggregate[];
  prevYearHF?: MonthlyHearingFilingAggregate[];
  prevYearRevenue?: RevenueProjection;
}

// ── Shared tooltip ────────────────────────────────────────────────

interface TooltipEntry {
  dataKey?: string | number;
  name?: string;
  value: number;
  color?: string;
  stroke?: string;
  payload?: Record<string, number | string>;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  formatter?: (v: number) => string;
  sortDesc?: boolean;
}

function ChartTooltip({ active, payload, label, formatter, sortDesc }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const items = sortDesc
    ? [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    : payload;
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-[var(--shadow-elevated)] px-3 py-2 text-sm">
      {label && <p className="font-medium text-[var(--text-muted)] text-xs mb-1">{label}</p>}
      {items.filter((p) => p.value > 0).map((p) => (
        <p key={p.dataKey} className="tabular-nums flex items-center gap-1.5" style={{ color: p.color || p.stroke }}>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color || p.stroke }} />
          <span className="font-semibold">{formatter ? formatter(p.value) : p.value}</span>
          <span className="text-[var(--text-muted)] text-xs">{p.name || p.dataKey}</span>
        </p>
      ))}
    </div>
  );
}

// ── Matter-type tooltips (hours + share) ──────────────────────────

interface MatterTypeSlice {
  name: string;
  hours: number;
  share: number;
  color: string;
}

function MatterTypeSliceTooltip({ active, payload }: { active?: boolean; payload?: { payload: MatterTypeSlice }[] }) {
  if (!active || !payload?.length) return null;
  const { name, hours, share, color } = payload[0].payload;
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-[var(--shadow-elevated)] px-3 py-2 text-sm">
      <p className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="font-semibold tabular-nums" style={{ color }}>{hours.toFixed(1)}h</span>
        <span className="text-[var(--text-muted)] tabular-nums text-xs">{share.toFixed(1)}%</span>
        <span className="text-[var(--text-muted)] text-xs">{name}</span>
      </p>
    </div>
  );
}

function MatterTypeMonthTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const total = Number(payload[0]?.payload?.monthTotal ?? 0);
  const items = [...payload]
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);
  if (items.length === 0) return null;
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-[var(--shadow-elevated)] px-3 py-2 text-sm">
      <p className="font-medium text-[var(--text-muted)] text-xs mb-1">
        {label} · <span className="tabular-nums">{total.toFixed(1)}h</span>
      </p>
      {items.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="font-semibold tabular-nums" style={{ color: p.color }}>{p.value.toFixed(1)}h</span>
          <span className="text-[var(--text-muted)] tabular-nums text-xs">
            {total > 0 ? ((p.value / total) * 100).toFixed(1) : '0.0'}%
          </span>
          <span className="text-[var(--text-muted)] text-xs">{p.name || p.dataKey}</span>
        </p>
      ))}
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] action-lift ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, toggleView, viewMode }: { icon: React.ElementType; title: string; toggleView?: () => void; viewMode?: 'chart' | 'table' }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gold-50 dark:bg-gold-500/10 flex items-center justify-center ring-1 ring-gold-200/60 dark:ring-gold-500/20">
            <Icon className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        <div className="h-0.5 w-8 bg-gradient-to-r from-gold-400 to-gold-300 rounded-full mt-1.5 ml-9" />
      </div>
      {toggleView && (
        <button type="button" onClick={toggleView} className="p-1.5 rounded-lg hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] hover:text-foreground transition-colors">
          {viewMode === 'chart' ? <Table className="w-4 h-4" /> : <BarChart3 className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="h-64 flex flex-col items-center justify-center text-center animate-fade-up">
      <div className="w-12 h-12 rounded-xl bg-[var(--subtle-bg)] flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-[var(--text-muted)]" />
      </div>
      <p className="text-sm text-[var(--text-muted)]">{message}</p>
    </div>
  );
}

// ── Deliverable status colors ─────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  [DELIVERABLE_STATUS.NOT_STARTED]: '#9ca3af',
  [DELIVERABLE_STATUS.DRAFTING]: '#3b82f6',
  [DELIVERABLE_STATUS.UNDER_REVIEW]: '#f97316',
  'For Initial Review': '#f97316',
  [DELIVERABLE_STATUS.REVISING]: '#a855f7',
  'For Revision': '#a855f7',
  [DELIVERABLE_STATUS.FINALIZING]: '#ef4444',
  [DELIVERABLE_STATUS.PRE_FINALIZED]: '#ec4899',
  'For Final Review': '#7c3aed',
  [DELIVERABLE_STATUS.AWAITING_CLIENT]: '#f59e0b',
  [DELIVERABLE_STATUS.OUTBOX]: '#14b8a6',
  'Ready to File': '#14b8a6',
};
const FALLBACK_COLORS = ['#fbbf24', '#d97706', '#78716c', '#f59e0b', '#a8a29e'];

const LAWYER_COLORS = [
  '#C9A84C', '#B8963A', '#A0822E', '#d4a853', '#e6c875',
  '#78716c', '#a8a29e', '#57534e', '#44403c', '#d6d3d1',
];

const MATTER_TYPE_COLORS: Record<string, string> = {
  'Litigation': '#C9A84C',
  'Retainer': '#3b82f6',
  'Special Project': '#a855f7',
  'Labor': '#14b8a6',
  'Intellectual Property': '#f97316',
  'Immigration': '#ec4899',
  'Incorporation': '#16a34a',
  'Post-Incorporation': '#4ade80',
  'Corporate Housekeeping': '#166534',
  [UNASSIGNED_MATTER_TYPE]: '#a8a29e',
};
const MATTER_TYPE_FALLBACK = ['#0ea5e9', '#84cc16', '#f59e0b', '#8b5cf6', '#64748b'];

const OUTCOME_COLORS: Record<string, string> = {
  favorable: '#16a34a',
  settled: '#3b82f6',
  dismissed: '#a8a29e',
  unfavorable: '#dc2626',
  other: '#78716c',
};

// ── Main component ────────────────────────────────────────────────

export default function PartnerAnalyticsDashboard({
  year,
  currentYear,
  dtrAggregates,
  deliverableSnapshot,
  hearingFilingAggregates,
  matterDistribution,
  currentMonthSummary,
  caseOutcomes,
  compare,
  revenueData,
  turnaroundStats,
  utilizationData,
  billingEfficiencyData,
  prevYearDTR,
  prevYearHF,
  prevYearRevenue,
}: Props) {
  const currentMonthLabel = MONTH_FULL[manilaMonthIndex()];

  // Interactive state
  const [selectedLawyer, setSelectedLawyer] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);

  const filteredOutcomeCases = useMemo(() => {
    if (!selectedOutcome) return [];
    if (selectedOutcome === 'pending') {
      // Pending cases don't have outcomes — they're not in recentOutcomes
      return [];
    }
    return caseOutcomes.recentOutcomes.filter((c) => c.classification === selectedOutcome);
  }, [selectedOutcome, caseOutcomes.recentOutcomes]);

  // Count-up values
  const animatedHours = useCountUp(currentMonthSummary.totalHours);
  const animatedDeliverables = useCountUp(deliverableSnapshot.total);
  const animatedHearings = useCountUp(totalHearingsValue());
  const animatedWinRate = useCountUp(winRateValue());
  const animatedTurnaround = useCountUp(turnaroundStats.totalAvgDays);

  function totalHearingsValue() {
    let total = 0;
    for (const agg of hearingFilingAggregates) total += agg.hearingCount;
    return total;
  }
  function winRateValue() {
    return caseOutcomes.total > 0
      ? Math.round(((caseOutcomes.favorable + caseOutcomes.settled) / caseOutcomes.total) * 100)
      : 0;
  }

  const {
    dtrTrendData,
    lawyerMonthlyData,
    topLawyers,
    hfTrendData,
    totalDTRHours,
    totalFilings,
  } = useMemo(() => {
    const dtrByMonth: Record<string, number> = {};
    const lawyerTotals: Record<string, number> = {};

    for (const agg of dtrAggregates) {
      const m = parseInt(agg.month.split('-')[1]);
      dtrByMonth[MONTH_LABELS[m - 1]] = agg.totalDecimalHours;
      for (const [name, hours] of Object.entries(agg.byLawyer)) {
        lawyerTotals[name] = (lawyerTotals[name] ?? 0) + hours;
      }
    }

    const dtrTrend = MONTH_LABELS.map((label) => ({
      period: label,
      hours: dtrByMonth[label] ?? 0,
    }));

    const hfByMonth: Record<string, { hearings: number; filings: number }> = {};
    for (const agg of hearingFilingAggregates) {
      const m = parseInt(agg.month.split('-')[1]);
      hfByMonth[MONTH_LABELS[m - 1]] = { hearings: agg.hearingCount, filings: agg.filingCount };
    }
    const hfTrend = MONTH_LABELS.map((label) => ({
      period: label,
      hearings: hfByMonth[label]?.hearings ?? 0,
      filings: hfByMonth[label]?.filings ?? 0,
    }));

    // Build monthly data per lawyer for stacked bar chart
    // Pick top N lawyers by total hours to keep the chart readable
    const topLawyers = Object.entries(lawyerTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    const lawyerMonthlyData = MONTH_LABELS.map((label) => {
      const row: Record<string, number | string> = { period: label };
      for (const name of topLawyers) {
        row[name] = 0;
      }
      return row;
    });
    for (const agg of dtrAggregates) {
      const m = parseInt(agg.month.split('-')[1]) - 1;
      for (const name of topLawyers) {
        lawyerMonthlyData[m][name] = agg.byLawyer[name] ?? 0;
      }
    }

    return {
      dtrTrendData: dtrTrend,
      lawyerMonthlyData,
      topLawyers,
      hfTrendData: hfTrend,
      totalDTRHours: dtrTrend.reduce((s, d) => s + d.hours, 0),
      totalHearings: hfTrend.reduce((s, d) => s + d.hearings, 0),
      totalFilings: hfTrend.reduce((s, d) => s + d.filings, 0),
    };
  }, [dtrAggregates, hearingFilingAggregates]);

  // ── YoY comparison data ──────────────────────────────────────────

  const dtrTrendWithPrev = useMemo(() => {
    if (!compare || !prevYearDTR) return dtrTrendData;
    const prevByMonth: Record<string, number> = {};
    for (const agg of prevYearDTR) {
      const m = parseInt(agg.month.split('-')[1]);
      prevByMonth[MONTH_LABELS[m - 1]] = agg.totalDecimalHours;
    }
    return dtrTrendData.map((d) => ({
      ...d,
      prevHours: prevByMonth[d.period] ?? 0,
    }));
  }, [dtrTrendData, compare, prevYearDTR]);

  const hfTrendWithPrev = useMemo(() => {
    if (!compare || !prevYearHF) return hfTrendData;
    const prevByMonth: Record<string, { hearings: number; filings: number }> = {};
    for (const agg of prevYearHF) {
      const m = parseInt(agg.month.split('-')[1]);
      prevByMonth[MONTH_LABELS[m - 1]] = { hearings: agg.hearingCount, filings: agg.filingCount };
    }
    return hfTrendData.map((d) => ({
      ...d,
      prevHearings: prevByMonth[d.period]?.hearings ?? 0,
      prevFilings: prevByMonth[d.period]?.filings ?? 0,
    }));
  }, [hfTrendData, compare, prevYearHF]);

  // ── Revenue data ─────────────────────────────────────────────────

  const revenueMonthlyData = useMemo(() => {
    const byMonth: Record<string, { billed: number; unbilled: number }> = {};
    for (const m of revenueData.byMonth) {
      const mi = parseInt(m.month.split('-')[1]);
      byMonth[MONTH_LABELS[mi - 1]] = { billed: m.billedRevenue, unbilled: m.unbilledRevenue };
    }
    const prevByMonth: Record<string, number> = {};
    if (compare && prevYearRevenue) {
      for (const m of prevYearRevenue.byMonth) {
        const mi = parseInt(m.month.split('-')[1]);
        prevByMonth[MONTH_LABELS[mi - 1]] = m.revenue;
      }
    }
    return MONTH_LABELS.map((label) => ({
      period: label,
      billed: byMonth[label]?.billed ?? 0,
      unbilled: byMonth[label]?.unbilled ?? 0,
      ...(compare && prevYearRevenue ? { prevRevenue: prevByMonth[label] ?? 0 } : {}),
    }));
  }, [revenueData, compare, prevYearRevenue]);

  const prevRevenueMonthly = compare && prevYearRevenue;

  // ── Month drill-down data ────────────────────────────────────────

  const expandedMonthData = useMemo(() => {
    if (!expandedMonth) return null;
    const monthIdx = MONTH_LABELS.indexOf(expandedMonth);
    if (monthIdx < 0) return null;
    const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    const agg = dtrAggregates.find((a) => a.month === monthKey);
    if (!agg) return null;
    const lawyers = Object.entries(agg.byLawyer)
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);
    const clients = Object.entries(agg.byClient)
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);
    return { lawyers, clients };
  }, [expandedMonth, dtrAggregates, year]);

  // Client DTR with month range filter
  const currentMonthIndex = manilaMonthIndex(); // 0-indexed
  const [clientMonthRange, setClientMonthRange] = useState<[number, number]>([0, currentMonthIndex]);

  const clientDTRData = useMemo(() => {
    const clientTotals: Record<string, number> = {};
    for (const agg of dtrAggregates) {
      const m = parseInt(agg.month.split('-')[1]) - 1; // 0-indexed
      if (m < clientMonthRange[0] || m > clientMonthRange[1]) continue;
      for (const [client, hours] of Object.entries(agg.byClient)) {
        clientTotals[client] = (clientTotals[client] ?? 0) + hours;
      }
    }
    return Object.entries(clientTotals)
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 15);
  }, [dtrAggregates, clientMonthRange]);

  const matterTypeData = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const agg of dtrAggregates) {
      for (const [type, hours] of Object.entries(agg.byMatterType)) {
        totals[type] = (totals[type] ?? 0) + hours;
      }
    }
    const ranked = Object.entries(totals)
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);
    const total = ranked.reduce((s, r) => s + r.hours, 0);
    return ranked.map((r, i) => ({
      ...r,
      share: total > 0 ? (r.hours / total) * 100 : 0,
      color: MATTER_TYPE_COLORS[r.name] ?? MATTER_TYPE_FALLBACK[i % MATTER_TYPE_FALLBACK.length],
    }));
  }, [dtrAggregates]);

  const matterTypeMonthlyData = useMemo(() => {
    const types = matterTypeData.map((t) => t.name);
    const byMonth = MONTH_LABELS.map((label) => {
      const row: Record<string, number | string> = { period: label };
      for (const t of types) row[t] = 0;
      return row;
    });
    for (const agg of dtrAggregates) {
      const m = parseInt(agg.month.split('-')[1]) - 1;
      let total = 0;
      for (const [type, hours] of Object.entries(agg.byMatterType)) {
        byMonth[m][type] = hours;
        total += hours;
      }
      byMonth[m].monthTotal = total;
    }
    return byMonth;
  }, [dtrAggregates, matterTypeData]);

  // Case outcome data
  const winRate = caseOutcomes.total > 0
    ? Math.round(((caseOutcomes.favorable + caseOutcomes.settled) / caseOutcomes.total) * 100)
    : 0;

  const outcomeDonutData = [
    { name: 'Win', value: caseOutcomes.favorable, color: '#16a34a' },
    { name: 'Settled', value: caseOutcomes.settled, color: '#3b82f6' },
    { name: 'Terminated', value: caseOutcomes.dismissed, color: '#a8a29e' },
    { name: 'Loss', value: caseOutcomes.unfavorable, color: '#dc2626' },
    { name: 'Other', value: caseOutcomes.other, color: '#78716c' },
  ].filter((d) => d.value > 0);

  // Current month progress
  const monthProgress = currentMonthSummary.daysInMonth > 0
    ? Math.round((currentMonthSummary.daysElapsed / currentMonthSummary.daysInMonth) * 100)
    : 0;

  const projectedHours = currentMonthSummary.daysElapsed > 0
    ? (currentMonthSummary.totalHours / currentMonthSummary.daysElapsed) * currentMonthSummary.daysInMonth
    : 0;

  const matterLawyerData = matterDistribution.byLawyer.map((l) => ({
    name: l.lawyerName,
    initials: l.initials,
    count: l.matterCount,
  }));

  // Billing efficiency
  const billingEfficiency = revenueData.totalRevenue > 0
    ? Math.round((revenueData.totalBilledRevenue / revenueData.totalRevenue) * 100)
    : 0;

  return (
    <div className="space-y-6 animate-fade-up">
      {/* ═══ Header ═══ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Partner Overview
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Firm-wide analytics for {year}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSelector year={year} currentYear={currentYear} />
          <button
            type="button"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set('compare', compare ? '0' : '1');
              window.location.href = url.toString();
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              compare
                ? 'bg-gold-50 dark:bg-gold-500/10 text-gold-700 dark:text-gold-300 border-gold-300/50 dark:border-gold-500/30'
                : 'text-[var(--text-muted)] hover:text-foreground border-[var(--border-color)] hover:bg-[var(--subtle-bg)]'
            }`}
          >
            vs {year - 1}
          </button>
        </div>
      </div>

      {/* ═══ Current Month Snapshot ═══ */}
      {year === currentYear && (
        <section id="month" className="animate-fade-up scroll-mt-20">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{currentMonthLabel} Snapshot</h2>
            <div className="flex-1 h-px bg-[var(--border-color)]" />
            <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
              Day {currentMonthSummary.daysElapsed} of {currentMonthSummary.daysInMonth}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-children">
            {/* Billable Hours */}
            <Card className="p-4 relative overflow-hidden animate-fade-up">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock className="w-3.5 h-3.5 text-gold-500 dark:text-gold-400" />
                <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Billable Hours</span>
              </div>
              <p className="text-2xl font-bold tabular-nums text-foreground">{animatedHours.toFixed(1)}</p>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-1.5 bg-[var(--subtle-bg)] rounded-full overflow-hidden">
                  <div className="h-full bg-gold-400 rounded-full transition-all" style={{ width: `${monthProgress}%` }} />
                </div>
                <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{monthProgress}%</span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                <TrendingUp className="w-3 h-3 inline mr-0.5 -mt-0.5" />
                Projected: <span className="font-semibold text-foreground">{projectedHours.toFixed(0)}h</span>
              </p>
            </Card>

            {/* Active Deliverables */}
            <Card className="p-4 animate-fade-up">
              <div className="flex items-center gap-1.5 mb-2">
                <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Deliverables</span>
              </div>
              <p className="text-2xl font-bold tabular-nums text-foreground">{Math.round(animatedDeliverables)}</p>
              {deliverableSnapshot.overdueCount > 0 ? (
                <div className="flex items-center gap-1 mt-2">
                  <AlertCircle className="w-3 h-3 text-red-500 dark:text-red-400" />
                  <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">{deliverableSnapshot.overdueCount} overdue</span>
                </div>
              ) : (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-2 font-medium">All on track</p>
              )}
            </Card>

            {/* Hearings */}
            <Card className="p-4 animate-fade-up">
              <div className="flex items-center gap-1.5 mb-2">
                <Scale className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400" />
                <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Hearings (YTD)</span>
              </div>
              <p className="text-2xl font-bold tabular-nums text-foreground">{Math.round(animatedHearings)}</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-2">
                <span className="font-semibold text-foreground">{totalFilings}</span> filings
              </p>
            </Card>

            {/* Win Rate */}
            <Card className="p-4 animate-fade-up">
              <div className="flex items-center gap-1.5 mb-2">
                <Award className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Win Rate</span>
              </div>
              <p className="text-2xl font-bold tabular-nums text-foreground">{Math.round(animatedWinRate)}%</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-2">
                <span className="font-semibold text-foreground">{caseOutcomes.favorable + caseOutcomes.settled}</span> of {caseOutcomes.total} resolved
              </p>
            </Card>

            {/* Billing Efficiency */}
            <Card className="p-4 animate-fade-up">
              <div className="flex items-center gap-1.5 mb-2">
                <DollarSign className="w-3.5 h-3.5 text-gold-500 dark:text-gold-400" />
                <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Billing Efficiency</span>
              </div>
              <p className="text-2xl font-bold tabular-nums text-foreground">{billingEfficiency}%</p>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-1.5 bg-[var(--subtle-bg)] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${billingEfficiency >= 70 ? 'bg-emerald-400' : billingEfficiency >= 40 ? 'bg-gold-400' : 'bg-red-400'}`} style={{ width: `${billingEfficiency}%` }} />
                </div>
                <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{billingEfficiency}%</span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                ₱{pesoFmt.format(revenueData.totalBilledRevenue)} / ₱{pesoFmt.format(revenueData.totalRevenue)}
              </p>
            </Card>

            {/* Avg Turnaround */}
            <Card className="p-4 animate-fade-up">
              <div className="flex items-center gap-1.5 mb-2">
                <Timer className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Avg Turnaround</span>
              </div>
              <p className="text-2xl font-bold tabular-nums text-foreground">{animatedTurnaround.toFixed(1)}d</p>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gold-400" />
                  <span className="text-[10px] text-[var(--text-muted)]">Draft: <span className="font-semibold text-foreground">{turnaroundStats.draftAvgDays.toFixed(1)}d</span></span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-[var(--text-muted)]">Final: <span className="font-semibold text-foreground">{turnaroundStats.finalizationAvgDays.toFixed(1)}d</span></span>
                </div>
              </div>
            </Card>
          </div>
        </section>
      )}

      {/* ═══ Monthly Hours Trend ═══ */}
      <section className="animate-fade-up">
        <Card className="p-4 sm:p-5">
          <SectionHeader icon={TrendingUp} title="Monthly Hours Trend" />
          {dtrTrendData.length === 0 ? (
            <EmptyState icon={TrendingUp} message={`No DTR data for ${year}`} />
          ) : (
            <>
              <div className="h-48 sm:h-64 lg:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dtrTrendWithPrev} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} interval={0} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} domain={[0, (max: number) => Math.ceil(max * 1.15)]} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}h`} />} cursor={{ fill: 'var(--subtle-bg)', opacity: 0.5 }} />
                    {totalDTRHours > 0 && (
                      <ReferenceLine
                        y={Math.round((totalDTRHours / 12) * 10) / 10}
                        stroke="var(--text-muted)"
                        strokeDasharray="4 4"
                        strokeWidth={1}
                        strokeOpacity={0.5}
                        label={{ value: `avg ${(totalDTRHours / 12).toFixed(0)}h`, position: 'insideTopRight', fill: 'var(--text-muted)', fontSize: 10 }}
                      />
                    )}
                    <Bar dataKey="hours" name="Hours" fill="#C9A84C" radius={[3, 3, 0, 0]} maxBarSize={32} activeBar={{ fill: '#B8963A' }} onClick={(data: BarRectangleItem) => setExpandedMonth(expandedMonth === data.payload?.period ? null : data.payload?.period ?? null)} style={{ cursor: 'pointer' }} />
                    {compare && prevYearDTR && (
                      <Bar dataKey="prevHours" name={`${year - 1}`} fill="#C9A84C" fillOpacity={0.15} stroke="#C9A84C" strokeDasharray="4 4" maxBarSize={32} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Month drill-down */}
              {expandedMonth && expandedMonthData && (
                <div className="mt-4 pt-4 border-t border-[var(--border-color)] animate-fade-up">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-foreground">{MONTH_FULL[MONTH_LABELS.indexOf(expandedMonth)]} {year} Breakdown</h3>
                    <button type="button" onClick={() => setExpandedMonth(null)} className="text-[10px] text-[var(--text-muted)] hover:text-foreground transition-colors">Close</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">By Lawyer</p>
                      <div className="space-y-1">
                        {expandedMonthData.lawyers.map((l) => (
                          <div key={l.name} className="flex items-center justify-between text-xs">
                            <span className="text-[var(--text-secondary)] truncate">{l.name}</span>
                            <span className="font-semibold text-foreground tabular-nums">{l.hours.toFixed(1)}h</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">By Client</p>
                      <div className="space-y-1">
                        {expandedMonthData.clients.slice(0, 10).map((c) => (
                          <div key={c.name} className="flex items-center justify-between text-xs">
                            <span className="text-[var(--text-secondary)] truncate">{c.name}</span>
                            <span className="font-semibold text-foreground tabular-nums">{c.hours.toFixed(1)}h</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </section>

      {/* ═══ Billing efficiency: raw vs effective vs actual billable ═══ */}
      <section className="animate-fade-up">
        <BillingEfficiencyPanel data={billingEfficiencyData} />
      </section>

      {/* ═══ Revenue Projection ═══ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-up">
        <Card className="p-4 sm:p-5">
          <SectionHeader icon={DollarSign} title="Monthly Revenue" />
          {revenueData.byMonth.length === 0 ? (
            <EmptyState icon={DollarSign} message="No revenue data" />
          ) : (
            <div className="h-48 sm:h-64 lg:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueMonthlyData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `₱${v.toLocaleString()}`} />} cursor={{ fill: 'var(--subtle-bg)', opacity: 0.5 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="billed" name="Billed" stackId="rev" fill="#C9A84C" radius={[0, 0, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="unbilled" name="Unbilled" stackId="rev" fill="#d6d3d1" radius={[3, 3, 0, 0]} maxBarSize={32} />
                  {compare && prevRevenueMonthly && (
                    <Bar dataKey="prevRevenue" name={`${year - 1}`} fill="#C9A84C" fillOpacity={0.15} stroke="#C9A84C" strokeDasharray="4 4" maxBarSize={32} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <SectionHeader icon={Users} title="Revenue by Lawyer" />
          {revenueData.byLawyer.length === 0 ? (
            <EmptyState icon={Users} message="No revenue data" />
          ) : (
            <div style={{ height: Math.min(Math.max(revenueData.byLawyer.length * 32, 200), 360) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData.byLawyer.slice(0, 10)} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} width={140} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `₱${v.toLocaleString()}`} />} cursor={{ fill: 'var(--subtle-bg)', opacity: 0.5 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#C9A84C" radius={[0, 3, 3, 0]} maxBarSize={20} activeBar={{ fill: '#B8963A' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>

      {/* ═══ Utilization ═══ */}
      {utilizationData.byLawyer.length > 0 && (
        <section id="utilization" className="animate-fade-up scroll-mt-20">
          <Card className="p-4 sm:p-5">
            <SectionHeader icon={Activity} title="Lawyer Utilization" />
            <div className="space-y-2.5">
              {utilizationData.byLawyer.map((l) => {
                const color = l.utilization >= 80 ? 'bg-emerald-400' : l.utilization >= 50 ? 'bg-gold-400' : 'bg-red-400';
                const textColor = l.utilization >= 80 ? 'text-emerald-600 dark:text-emerald-400' : l.utilization >= 50 ? 'text-gold-600 dark:text-gold-400' : 'text-red-600 dark:text-red-400';
                return (
                  <div key={l.name} className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-secondary)] w-24 sm:w-32 truncate shrink-0">{l.name}</span>
                    <div className="flex-1 h-2 bg-[var(--subtle-bg)] rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${Math.min(l.utilization, 100)}%` }} />
                    </div>
                    <span className={`text-xs font-semibold tabular-nums w-12 text-right shrink-0 ${textColor}`}>{l.utilization.toFixed(1)}%</span>
                  </div>
                );
              })}
              <div className="pt-2 mt-2 border-t border-[var(--border-color)] flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">Firm Average</span>
                <span className="text-xs font-bold text-foreground tabular-nums">{utilizationData.firmAverage.toFixed(1)}%</span>
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* ═══ Case Outcomes & Deliverable Status ═══ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-up">
        {/* Case Outcomes */}
        <Card className="p-4 sm:p-5">
          <SectionHeader icon={Award} title="Case Outcomes" />
          {caseOutcomes.total === 0 ? (
            <EmptyState icon={Award} message="No resolved cases yet" />
          ) : (
            <div>
              <div className="flex items-center gap-6">
                <div className="w-40 h-40 shrink-0 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={outcomeDonutData} cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" paddingAngle={2} dataKey="value" nameKey="name" stroke="none">
                        {outcomeDonutData.map((entry) => (<Cell key={entry.name} fill={entry.color} />))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <p className="text-xl font-bold text-foreground tabular-nums">{winRate}%</p>
                      <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">win rate</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 space-y-2">
                  {outcomeDonutData.map((d) => (
                    <button
                      key={d.name}
                      type="button"
                      onClick={() => setSelectedOutcome(selectedOutcome === d.name.toLowerCase() ? null : d.name.toLowerCase())}
                      className={`flex items-center justify-between w-full rounded-md px-1.5 py-0.5 transition-colors cursor-pointer ${
                        selectedOutcome === d.name.toLowerCase()
                          ? 'bg-[var(--subtle-bg)]'
                          : 'hover:bg-[var(--subtle-bg)]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-xs text-[var(--text-secondary)]">{d.name}</span>
                      </div>
                      <span className="text-xs font-semibold text-foreground tabular-nums">{d.value}</span>
                    </button>
                  ))}
                  {caseOutcomes.pending > 0 && (
                    <div className="pt-1.5 mt-1.5 border-t border-[var(--border-color)]">
                      <button
                        type="button"
                        onClick={() => setSelectedOutcome(selectedOutcome === 'pending' ? null : 'pending')}
                        className={`flex items-center justify-between w-full rounded-md px-1.5 py-0.5 transition-colors cursor-pointer ${
                          selectedOutcome === 'pending' ? 'bg-[var(--subtle-bg)]' : 'hover:bg-[var(--subtle-bg)]'
                        }`}
                      >
                        <span className="text-xs text-[var(--text-muted)]">Ongoing / Pending</span>
                        <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">{caseOutcomes.pending}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Case detail panel */}
              {selectedOutcome && (
                <div className="mt-4 pt-4 border-t border-[var(--border-color)] animate-fade-up">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                      {selectedOutcome === 'pending' ? 'Ongoing / Pending Cases' : `${selectedOutcome.charAt(0).toUpperCase() + selectedOutcome.slice(1)} Cases`}
                    </p>
                    <button type="button" onClick={() => setSelectedOutcome(null)} className="text-[10px] text-[var(--text-muted)] hover:text-foreground transition-colors cursor-pointer">
                      Close
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {filteredOutcomeCases.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)] py-2">No cases found</p>
                    ) : (
                      filteredOutcomeCases.map((c, i) => {
                        const outcomeColor = OUTCOME_COLORS[c.classification] ?? '#78716c';
                        return (
                          <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-[var(--subtle-bg)] transition-colors">
                            <div className="flex-1 min-w-0 mr-3">
                              <p className="text-xs font-medium text-foreground truncate">{c.name}</p>
                              <p className="text-[10px] text-[var(--text-muted)] truncate">{c.clientName}{c.type ? ` · ${c.type}` : ''}</p>
                            </div>
                            {c.outcome && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0" style={{ color: outcomeColor, backgroundColor: `${outcomeColor}15` }}>
                                {c.outcome}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {!selectedOutcome && caseOutcomes.byType.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                  <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">By Practice Area</p>
                  <div className="space-y-1.5">
                    {caseOutcomes.byType.slice(0, 6).map((t) => {
                      const favRate = t.total > 0 ? Math.round((t.favorable / t.total) * 100) : 0;
                      return (
                        <div key={t.type} className="flex items-center gap-2">
                          <span className="text-xs text-[var(--text-secondary)] w-20 sm:w-24 truncate shrink-0">{t.type}</span>
                          <div className="flex-1 h-1.5 bg-[var(--subtle-bg)] rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-400 dark:bg-emerald-500 rounded-full" style={{ width: `${favRate}%` }} />
                          </div>
                          <span className="text-[10px] text-[var(--text-muted)] tabular-nums w-8 text-right shrink-0">{favRate}%</span>
                          <span className="text-[10px] text-[var(--text-muted)] tabular-nums w-6 text-right shrink-0">({t.total})</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Deliverable Pipeline */}
        <Card className="p-4 sm:p-5">
          <SectionHeader icon={Target} title="Deliverable Pipeline" />
          {deliverableSnapshot.byStatus.length === 0 ? (
            <EmptyState icon={Target} message="No active deliverables" />
          ) : (
            <div>
              <div className="flex items-center gap-6">
                <div className="w-40 h-40 shrink-0 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={deliverableSnapshot.byStatus} cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" paddingAngle={2} dataKey="count" nameKey="status" stroke="none">
                        {deliverableSnapshot.byStatus.map((entry, i) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <p className="text-xl font-bold text-foreground tabular-nums">{deliverableSnapshot.total}</p>
                      <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">active</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 space-y-1.5 max-h-[160px] overflow-y-auto">
                  {deliverableSnapshot.byStatus.map((item, i) => (
                    <div key={item.status} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[item.status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
                        <span className="text-xs text-[var(--text-secondary)]">{item.status}</span>
                      </div>
                      <span className="text-xs font-semibold text-foreground tabular-nums">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {deliverableSnapshot.overdueCount > 0 && (
                <div className="mt-3 px-3 py-2 bg-red-50 dark:bg-red-500/10 border border-red-200/80 dark:border-red-500/20 rounded-lg text-xs text-red-700 dark:text-red-400 font-semibold text-center">
                  {deliverableSnapshot.overdueCount} overdue deliverable{deliverableSnapshot.overdueCount !== 1 ? 's' : ''}
                </div>
              )}

              {deliverableSnapshot.byLawyer.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                  <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Workload by Lawyer</p>
                  <div className="space-y-1.5">
                    {deliverableSnapshot.byLawyer.slice(0, 6).map((l) => {
                      const maxP = Math.max(...deliverableSnapshot.byLawyer.map((x) => x.pending), 1);
                      return (
                        <div key={l.lawyerName} className="flex items-center gap-2">
                          <span className="text-xs text-[var(--text-secondary)] w-20 sm:w-24 truncate shrink-0">{l.lawyerName}</span>
                          <div className="flex-1 h-1.5 bg-[var(--subtle-bg)] rounded-full overflow-hidden">
                            <div className="h-full bg-gold-400 rounded-full" style={{ width: `${Math.max((l.pending / maxP) * 100, 4)}%` }} />
                          </div>
                          <span className="text-[10px] text-foreground font-semibold tabular-nums w-5 text-right shrink-0">{l.pending}</span>
                          {l.overdue > 0 && <span className="text-[10px] text-red-600 dark:text-red-400 font-semibold tabular-nums">({l.overdue})</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </section>

      {/* ═══ Lawyer Hours by Month ═══ */}
      <section className="animate-fade-up">
        <Card className="p-4 sm:p-5">
          <SectionHeader icon={Users} title="Hours by Lawyer" />
          {topLawyers.length === 0 ? (
            <EmptyState icon={Users} message="No DTR data" />
          ) : (
            <div className="h-72 sm:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lawyerMonthlyData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}h`} sortDesc />} cursor={{ fill: 'var(--subtle-bg)', opacity: 0.5 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  {/* Render smallest first (bottom) so biggest lawyer is on top */}
                  {[...topLawyers].reverse().map((name) => {
                    const i = topLawyers.indexOf(name);
                    return <Bar key={name} dataKey={name} stackId="lawyers" fill={LAWYER_COLORS[i % LAWYER_COLORS.length]} maxBarSize={32} onClick={() => setSelectedLawyer(selectedLawyer === name ? null : name)} style={{ cursor: 'pointer' }} />;
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>

      {/* ═══ Lawyer Detail Panel ═══ */}
      {selectedLawyer && (
        <section className="animate-fade-up">
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">{selectedLawyer} - Detail</h3>
              <button type="button" onClick={() => setSelectedLawyer(null)} className="text-[10px] text-[var(--text-muted)] hover:text-foreground transition-colors">Close</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Monthly hours for selected lawyer */}
              <div>
                <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Monthly Hours</p>
                <div className="space-y-1">
                  {MONTH_LABELS.map((label, idx) => {
                    const hours = Number(lawyerMonthlyData[idx]?.[selectedLawyer] ?? 0);
                    if (hours === 0) return null;
                    return (
                      <div key={label} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">{label}</span>
                        <span className="font-semibold text-foreground tabular-nums">{hours.toFixed(1)}h</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Revenue for selected lawyer */}
              <div>
                <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Revenue</p>
                {(() => {
                  const lawyerRev = revenueData.byLawyer.find((l) => l.name === selectedLawyer);
                  if (!lawyerRev) return <p className="text-xs text-[var(--text-muted)]">No revenue data</p>;
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">Total</span>
                        <span className="font-semibold text-foreground tabular-nums">₱{pesoFmt.format(lawyerRev.revenue)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">Rate</span>
                        <span className="font-semibold text-foreground tabular-nums">₱{pesoFmt.format(lawyerRev.rate)}/hr</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">Hours</span>
                        <span className="font-semibold text-foreground tabular-nums">{lawyerRev.hours.toFixed(1)}h</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
              {/* Utilization for selected lawyer */}
              <div>
                <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Utilization</p>
                {(() => {
                  const lawyerUtil = utilizationData.byLawyer.find((l) => l.name === selectedLawyer);
                  if (!lawyerUtil) return <p className="text-xs text-[var(--text-muted)]">No utilization data</p>;
                  const color = lawyerUtil.utilization >= 80 ? 'text-emerald-600 dark:text-emerald-400' : lawyerUtil.utilization >= 50 ? 'text-gold-600 dark:text-gold-400' : 'text-red-600 dark:text-red-400';
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">Rate</span>
                        <span className={`font-semibold tabular-nums ${color}`}>{lawyerUtil.utilization.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">Working Days</span>
                        <span className="font-semibold text-foreground tabular-nums">{lawyerUtil.workingDays}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* ═══ Client Hours ═══ */}
      <section className="animate-fade-up">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionHeader icon={Briefcase} title="Top Clients by Hours" />
            <span className="text-xs text-[var(--text-muted)] tabular-nums shrink-0">
              {MONTH_LABELS[clientMonthRange[0]]} – {MONTH_LABELS[clientMonthRange[1]]} {year}
            </span>
          </div>
          {clientDTRData.length === 0 ? (
            <EmptyState icon={Briefcase} message="No DTR data for selected months" />
          ) : (
            <div style={{ height: Math.min(Math.max(clientDTRData.length * 32, 200), 360) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={clientDTRData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} width={140} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}h`} />} cursor={{ fill: 'var(--subtle-bg)', opacity: 0.5 }} />
                  <Bar dataKey="hours" name="Hours" fill="#d97706" radius={[0, 3, 3, 0]} maxBarSize={20} activeBar={{ fill: '#b45309' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Month range slider */}
          <div className="mt-4 pt-3 border-t border-[var(--border-color)]">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 flex-1">
                {MONTH_LABELS.map((label, i) => {
                  const inRange = i >= clientMonthRange[0] && i <= clientMonthRange[1];
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={(e) => {
                        if (e.shiftKey) {
                          // Shift-click extends range
                          if (i < clientMonthRange[0]) setClientMonthRange([i, clientMonthRange[1]]);
                          else if (i > clientMonthRange[1]) setClientMonthRange([clientMonthRange[0], i]);
                          else setClientMonthRange([i, i]);
                        } else {
                          // Regular click selects single month
                          if (i === clientMonthRange[0] && i === clientMonthRange[1]) return;
                          setClientMonthRange([i, i]);
                        }
                      }}
                      className={`flex-1 py-1 text-[10px] font-medium rounded transition-all duration-150 cursor-pointer ${
                        inRange
                          ? 'bg-gold-400/20 text-gold-700 dark:text-gold-300 border border-gold-300/50 dark:border-gold-500/30'
                          : 'text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] border border-transparent'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setClientMonthRange([0, currentMonthIndex])}
                className="text-[10px] font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 px-2 py-1 rounded hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-colors cursor-pointer shrink-0"
              >
                YTD
              </button>
            </div>
          </div>
        </Card>
      </section>

      {/* ═══ Hours by Matter Type ═══ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-up">
        <Card className="p-4 sm:p-5">
          <SectionHeader icon={Scale} title="Hours by Matter Type" />
          {matterTypeData.length === 0 ? (
            <EmptyState icon={Scale} message={`No DTR data for ${year}`} />
          ) : (
            <div className="flex items-center gap-6">
              <div className="w-40 h-40 shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={matterTypeData} cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" paddingAngle={2} dataKey="hours" nameKey="name" stroke="none">
                      {matterTypeData.map((entry) => (<Cell key={entry.name} fill={entry.color} />))}
                    </Pie>
                    <Tooltip content={<MatterTypeSliceTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-xl font-bold text-foreground tabular-nums">{totalDTRHours.toFixed(0)}</p>
                    <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">hours</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-1.5 max-h-[160px] overflow-y-auto">
                {matterTypeData.map((t) => (
                  <div key={t.name} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                      <span className="text-xs text-[var(--text-secondary)] truncate">{t.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-semibold text-foreground tabular-nums">{t.hours.toFixed(1)}h</span>
                      <span className="text-[10px] text-[var(--text-muted)] tabular-nums w-9 text-right">{t.share.toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <SectionHeader icon={TrendingUp} title="Matter Type Mix by Month" />
          {matterTypeData.length === 0 ? (
            <EmptyState icon={TrendingUp} message={`No DTR data for ${year}`} />
          ) : (
            <div className="h-48 sm:h-64 lg:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={matterTypeMonthlyData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<MatterTypeMonthTooltip />} cursor={{ fill: 'var(--subtle-bg)', opacity: 0.5 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  {/* Render smallest first (bottom) so the dominant type sits on top */}
                  {[...matterTypeData].reverse().map((t) => (
                    <Bar key={t.name} dataKey={t.name} stackId="matterTypes" fill={t.color} maxBarSize={32} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>

      {/* ═══ Hearings & Filings + Matter Assignments ═══ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-up">
        <Card className="p-4 sm:p-5">
          <SectionHeader icon={Scale} title="Hearings & Filings Trend" />
          {hfTrendData.length === 0 ? (
            <EmptyState icon={Scale} message={`No data for ${year}`} />
          ) : (
            <div className="h-48 sm:h-64 lg:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hfTrendWithPrev} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
                  <defs>
                    <linearGradient id="hearingsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#C9A84C" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#C9A84C" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="filingsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#78716c" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#78716c" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="hearings" stroke="#B8963A" strokeWidth={2} fill="url(#hearingsGrad)" name="Hearings" />
                  <Area type="monotone" dataKey="filings" stroke="#57534e" strokeWidth={2} fill="url(#filingsGrad)" name="Filings" />
                  {compare && prevYearHF && (
                    <>
                      <Area type="monotone" dataKey="prevHearings" stroke="#B8963A" strokeDasharray="4 4" strokeWidth={1.5} fill="none" name={`Hearings ${year - 1}`} />
                      <Area type="monotone" dataKey="prevFilings" stroke="#57534e" strokeDasharray="4 4" strokeWidth={1.5} fill="none" name={`Filings ${year - 1}`} />
                    </>
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <SectionHeader icon={Briefcase} title="Matters by Lawyer" />
          {matterLawyerData.length === 0 ? (
            <EmptyState icon={Briefcase} message="No matter data" />
          ) : (
            <div className="h-48 sm:h-64 lg:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={matterLawyerData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="initials" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} matter${v !== 1 ? 's' : ''}`} />} cursor={{ fill: 'var(--subtle-bg)', opacity: 0.5 }} />
                  <Bar dataKey="count" name="Matters" fill="#C9A84C" radius={[3, 3, 0, 0]} maxBarSize={32} activeBar={{ fill: '#B8963A' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

// ── Billing efficiency panel ──────────────────────────────────────

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtPHPShort(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) return `₱${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `₱${(amount / 1_000).toFixed(0)}k`;
  return `₱${amount.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
}

function BillingEfficiencyPanel({ data }: { data: BillingEfficiency }) {
  const writeDown = data.totalProjectedRevenue - data.totalActualBillable;
  const realization = data.totalProjectedRevenue > 0
    ? (data.totalActualBillable / data.totalProjectedRevenue) * 100
    : 0;
  // Positive: effective < raw (finance reduced). Negative: effective > raw (finance added).
  const hourGap = data.totalRawBillableHours - data.totalEffectiveBillableHours;
  const editsLabel: { text: string; tone: 'emerald' | 'amber' | undefined } = (() => {
    if (Math.abs(hourGap) <= 0.05) return { text: 'no finance edits', tone: undefined };
    const tentative = data.hasTentativeEdits ? ' (tentative)' : '';
    if (hourGap > 0) return { text: `−${hourGap.toFixed(1)}h after edits${tentative}`, tone: 'amber' };
    return { text: `+${Math.abs(hourGap).toFixed(1)}h after edits${tentative}`, tone: 'amber' };
  })();

  const chartData = useMemo(() => {
    return data.byMonth.map((m) => {
      const mNum = parseInt(m.month.split('-')[1] ?? '0');
      return {
        month: MONTH_SHORT[mNum - 1] ?? m.month,
        projected: Math.round(m.projectedRevenue),
        billable: Math.round(m.actualBillable),
      };
    });
  }, [data.byMonth]);

  return (
    <Card className="p-4 sm:p-5">
      <SectionHeader icon={DollarSign} title="Billing efficiency — effort vs revenue" />
      <p className="text-xs text-[var(--text-muted)] mb-4">
        Raw hours = effort logged. Effective hours = post finance edits. Projected revenue = raw × rate. Actual billable = post edits, with retainer caps applied.
      </p>

      {data.hasTentativeEdits && (
        <div className="mb-4 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <strong className="font-semibold">{data.tentativeBundleCount} bundle{data.tentativeBundleCount === 1 ? '' : 's'}</strong> with finance edits awaiting managing-partner approval. Numbers below reflect those tentative edits.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Metric label="Raw billable hours" value={`${data.totalRawBillableHours.toFixed(1)}h`} sub={`${data.totalRawHours.toFixed(1)}h logged total`} />
        <Metric
          label="Effective billable hours"
          value={`${data.totalEffectiveBillableHours.toFixed(1)}h`}
          sub={editsLabel.text}
          subTone={editsLabel.tone}
        />
        <Metric label="Projected revenue" value={fmtPHPShort(data.totalProjectedRevenue)} sub="hours × rate, no caps" />
        <Metric
          label="Actual billable"
          value={fmtPHPShort(data.totalActualBillable)}
          sub={`${realization.toFixed(0)}% realization`}
          tone="emerald"
          subTone={realization < 80 ? 'amber' : 'emerald'}
        />
      </div>

      {writeDown > 0 && (
        <div className="mb-5 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-200">
            <strong className="font-semibold">{fmtPHPShort(writeDown)} write-down</strong> across the period —
            difference between projected revenue and actual billable. Sources: retainer caps, fixed-fee matters, finance edits, and non-billable categorization.
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="h-48 sm:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-color)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtPHPShort(v)} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => fmtPHPShort(v)} />} cursor={{ fill: 'var(--subtle-bg)', opacity: 0.5 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="projected" name="Projected revenue" fill="#C9A84C" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar dataKey="billable" name="Actual billable" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Metric({
  label, value, sub, tone, subTone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'emerald';
  subTone?: 'emerald' | 'amber';
}) {
  const valueClass = tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground';
  const subClass =
    subTone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : subTone === 'emerald'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-[var(--text-muted)]';
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--subtle-bg)]/30 p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">{label}</p>
      <p className={`text-base font-semibold tabular-nums mt-0.5 ${valueClass}`}>{value}</p>
      {sub && <p className={`text-[11px] mt-0.5 tabular-nums ${subClass}`}>{sub}</p>}
    </div>
  );
}
