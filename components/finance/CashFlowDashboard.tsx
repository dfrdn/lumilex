'use client';

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts';
import { Loader2, Activity, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import SingleSelect from '@/components/finance/SingleSelect';
import CashFlowDetailPanel from '@/components/finance/CashFlowDetailPanel';
import { CHART_THEME_VARS } from '@/components/finance/chart-theme';
import { fmt, signed, fmtCompact, formatManilaDate } from '@/lib/finance/format';
import useSWR from 'swr';

interface MonthlyRow {
  month: string;
  incomeBilled: number;
  incomeCollected: number;
  expenses: number;
  expenseByCategory: Record<string, number>;
  netBilled: number;
  netCollected: number;
}
interface YearlyRow {
  year: string;
  incomeBilled: number;
  incomeCollected: number;
  expenses: number;
  expenseByCategory: Record<string, number>;
  netBilled: number;
  netCollected: number;
}
interface CashFlowResponse { monthly: MonthlyRow[]; yearly: YearlyRow[] }

type Basis = 'collected' | 'billed';
type View = 'monthly' | 'yearly';

const BASIS_OPTIONS = [
  { id: 'collected', label: 'Collected (cash)' },
  { id: 'billed', label: 'Billed (accrual)' },
];
const VIEW_OPTIONS = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

// Stable category palette; Bonuses gets a distinct violet.
const CATEGORY_COLORS: Record<string, string> = {
  Rent: '#fbbf24', Payroll: '#f97316', Utilities: '#38bdf8', Software: '#818cf8',
  Taxes: '#f43f5e', 'Professional Fees': '#34d399', 'Office Supplies': '#a3a3a3',
  'Bank Charges': '#facc15', Bonuses: '#a78bfa', Other: '#94a3b8',
};
const FALLBACK_COLORS = ['#fbbf24', '#f97316', '#38bdf8', '#818cf8', '#34d399', '#f43f5e', '#a78bfa', '#94a3b8'];

function colorFor(cat: string, idx: number) {
  return CATEGORY_COLORS[cat] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

const cardCls = 'bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70';
const axisTick = { fontSize: 11, fill: '#a8a29e' };

export default function CashFlowDashboard() {
  const [basis, setBasis] = useState<Basis>('collected');
  const [view, setView] = useState<View>('monthly');
  const { data: fetched, error: loadError, isLoading: loading } = useSWR<CashFlowResponse>('/api/finance/cash-flow', async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to load (${r.status})`);
    return r.json();
  });
  const data = fetched ?? null;
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Failed to load') : '';
  const [drillPeriod, setDrillPeriod] = useState<string | null>(null);


  const series = useMemo(() => {
    const rows = view === 'monthly' ? (data?.monthly ?? []) : (data?.yearly ?? []);
    return rows.map((r) => ({
      period: 'month' in r ? (r as MonthlyRow).month : (r as YearlyRow).year,
      incomeBilled: r.incomeBilled,
      incomeCollected: r.incomeCollected,
      income: basis === 'collected' ? r.incomeCollected : r.incomeBilled,
      expenses: r.expenses,
      net: basis === 'collected' ? r.netCollected : r.netBilled,
      expenseByCategory: r.expenseByCategory,
    }));
  }, [data, view, basis]);

  // Map each category to a SAFE synthetic data key (c0, c1, …). Category names are
  // finance-editable, so using them directly as recharts dataKeys is unsafe — a
  // name containing '.' is read as a nested path, and a name like "period" would
  // clobber the X-axis key. The display name (legend/tooltip) stays the category.
  const catKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of series) for (const k of Object.keys(r.expenseByCategory)) set.add(k);
    return [...set].map((cat, i) => ({ cat, key: `c${i}`, color: colorFor(cat, i) }));
  }, [series]);

  const stackedExpenseData = useMemo(
    () => series.map((r) => {
      const row: Record<string, number | string> = { period: r.period };
      for (const { cat, key } of catKeys) row[key] = r.expenseByCategory[cat] ?? 0;
      return row;
    }),
    [series, catKeys],
  );

  const totals = useMemo(() => {
    const income = series.reduce((s, r) => s + r.income, 0);
    const expenses = series.reduce((s, r) => s + r.expenses, 0);
    return { income, expenses, net: income - expenses };
  }, [series]);

  // A Bar's onClick hands the clicked datum (its original row on `.payload`);
  // `period` is the YYYY-MM (monthly) or YYYY (yearly) key to drill into.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onBarClick = (entry: any) => {
    const period = entry?.payload?.period ?? entry?.period;
    if (typeof period === 'string') setDrillPeriod(period);
  };

  const drillLabel = drillPeriod
    ? (/^\d{4}-\d{2}$/.test(drillPeriod)
      ? formatManilaDate(`${drillPeriod}-01`, { year: 'numeric', month: 'long' })
      : drillPeriod)
    : '';

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground font-serif flex items-center gap-2">
            <Activity className="w-5 h-5 text-[var(--text-muted)]" />
            Cash Flow
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Money in vs money out — firm financial health across {view === 'monthly' ? 'months' : 'years'}.
          </p>
        </div>
        <div className="flex items-end gap-4">
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Income basis</label>
            <SingleSelect value={basis} options={BASIS_OPTIONS} placeholder="Basis" onChange={(v) => { if (v) setBasis(v as Basis); }} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">View</label>
            <SingleSelect value={view} options={VIEW_OPTIONS} placeholder="View" onChange={(v) => { if (v) setView(v as View); }} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>
      ) : error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400 text-sm">{error}</div>
      ) : series.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" /> No cash-flow data yet. Record invoices, payments, or operating expenses to populate this dashboard.
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <SummaryCard icon={TrendingUp} label={`Income (${basis})`} value={totals.income} tone="emerald" />
            <SummaryCard icon={TrendingDown} label="Money out" value={totals.expenses} tone="rose" />
            <SummaryCard label="Net cash flow" value={totals.net} tone={totals.net >= 0 ? 'emerald' : 'rose'} signedValue />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Net cash flow */}
            <div className={cardCls}>
              <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Net cash flow ({basis})</h3>
              <div className="h-64 sm:h-72">
                <ResponsiveContainer width="100%" height="100%" className={CHART_THEME_VARS}>
                  <BarChart data={series} margin={{ top: 5, right: 5, bottom: 5, left: 5 }} className="cursor-pointer">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                    <XAxis dataKey="period" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} interval={0} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={56} />
                    <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#f5f5f4', opacity: 0.5 }} />
                    <ReferenceLine y={0} stroke="#d6d3d1" strokeWidth={1} />
                    <Bar dataKey="net" radius={[3, 3, 0, 0]} maxBarSize={view === 'yearly' ? 56 : 36} isAnimationActive={false} onClick={onBarClick}>
                      {series.map((r, i) => (
                        <Cell key={i} fill={r.net >= 0 ? '#34d399' : '#f43f5e'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Revenue vs collections */}
            <div className={cardCls}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Revenue vs collections</h3>
                <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Click a bar for details</span>
              </div>
              <div className="h-64 sm:h-72">
                <ResponsiveContainer width="100%" height="100%" className={CHART_THEME_VARS}>
                  <BarChart data={series} margin={{ top: 5, right: 5, bottom: 5, left: 5 }} className="cursor-pointer">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                    <XAxis dataKey="period" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} interval={0} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={56} />
                    <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#f5f5f4', opacity: 0.5 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar name="Billed" dataKey="incomeBilled" fill="#fbbf24" radius={[3, 3, 0, 0]} maxBarSize={view === 'yearly' ? 28 : 18} isAnimationActive={false} onClick={onBarClick} />
                    <Bar name="Collected" dataKey="incomeCollected" fill="#34d399" radius={[3, 3, 0, 0]} maxBarSize={view === 'yearly' ? 28 : 18} isAnimationActive={false} onClick={onBarClick} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Expenses by category */}
            <div className={`${cardCls} lg:col-span-2`}>
              <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Money out by category</h3>
              {catKeys.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
                  No operating expenses or bonuses in this range.
                </div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" className={CHART_THEME_VARS}>
                    <BarChart data={stackedExpenseData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                      <XAxis dataKey="period" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} interval={0} />
                      <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={56} />
                      <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#f5f5f4', opacity: 0.5 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {catKeys.map(({ cat, key, color }) => (
                        <Bar key={key} dataKey={key} name={cat} stackId="exp" fill={color} maxBarSize={view === 'yearly' ? 56 : 36} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {drillPeriod && (
            <div className="mt-4">
              <CashFlowDetailPanel period={drillPeriod} periodLabel={drillLabel} onClose={() => setDrillPeriod(null)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MoneyTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name?: string; dataKey?: string | number; value?: number; color?: string; fill?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-2 text-xs dark:bg-stone-900 dark:border-stone-700">
      <p className="font-medium text-stone-600 dark:text-stone-300 mb-1">{label}</p>
      {payload.filter((p) => p.value).map((p) => (
        <p key={p.dataKey} className="tabular-nums flex items-center justify-between gap-3" style={{ color: p.color || p.fill }}>
          <span>{p.name}</span>
          <span className="font-semibold">{signed(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

function SummaryCard({
  icon: Icon, label, value, tone, signedValue,
}: {
  icon?: typeof TrendingUp;
  label: string;
  value: number;
  tone: 'emerald' | 'rose' | 'neutral';
  signedValue?: boolean;
}) {
  const toneClasses: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose: 'text-rose-600 dark:text-rose-400',
    neutral: 'text-foreground',
  };
  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <p className={`text-xl font-semibold tabular-nums ${toneClasses[tone]}`}>
        {signedValue ? signed(value) : fmt(value)}
      </p>
    </div>
  );
}
