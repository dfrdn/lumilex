'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Loader2, TrendingUp, Wallet, Gauge, AlertCircle } from 'lucide-react';
import MonthSelect from '@/components/finance/MonthSelect';
import { manilaMonth } from '@/lib/dates';

interface UtilizationRow {
  lawyerName: string;
  position: string;
  billableHours: number;
  billedHours: number;
  workedHours: number;
  capacityHours: number;
  billableUtilization: number;
  billedAmount: number;
  billableAmount: number;
  realizationRate: number;
  effectiveRate: number;
}

interface ApiResponse {
  from: string;
  to: string;
  monthCount: number;
  rows: UtilizationRow[];
  unmappedLawyerCount: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function currentMonth(): string {
  return manilaMonth();
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

function formatPHP(n: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(n);
}

function utilizationTone(util: number): { bar: string; text: string; bg: string } {
  if (util >= 1.2) return { bar: 'bg-red-500', text: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' };
  if (util >= 0.9) return { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' };
  if (util >= 0.5) return { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' };
  return { bar: 'bg-stone-400', text: 'text-stone-500 dark:text-stone-400', bg: 'bg-stone-50 dark:bg-stone-800/50' };
}

function realizationTone(rate: number): string {
  if (rate >= 0.85) return 'text-emerald-700 dark:text-emerald-400';
  if (rate >= 0.6) return 'text-amber-600 dark:text-amber-400';
  if (rate > 0) return 'text-red-600 dark:text-red-400';
  return 'text-stone-400 dark:text-stone-500';
}

export default function FinancialUtilizationTab() {
  const [fromMonth, setFromMonth] = useState(currentMonth);
  const [toMonth, setToMonth] = useState(currentMonth);

  const swap = fromMonth > toMonth ? toMonth : fromMonth;
  const effFromMonth = fromMonth > toMonth ? toMonth : fromMonth;
  const effToMonth = fromMonth > toMonth ? fromMonth : toMonth;
  void swap;

  const fromDate = `${effFromMonth}-01`;
  const toDate = lastDayOfMonth(effToMonth);

  const { data, isLoading, error } = useSWR<ApiResponse>(
    `/api/finance/utilization?from=${fromDate}&to=${toDate}`,
    fetcher,
    { keepPreviousData: true },
  );

  const rows = data?.rows ?? [];

  const totals = useMemo(() => {
    let billable = 0;
    let billedHours = 0;
    let worked = 0;
    let capacity = 0;
    let billed = 0;
    let billableAmt = 0;
    for (const r of rows) {
      billable += r.billableHours;
      billedHours += r.billedHours;
      worked += r.workedHours;
      capacity += r.capacityHours;
      billed += r.billedAmount;
      billableAmt += r.billableAmount;
    }
    return {
      billable,
      billedHours,
      worked,
      capacity,
      billed,
      billableAmt,
      avgUtilization: capacity > 0 ? billable / capacity : 0,
      firmRealization: billableAmt > 0 ? billed / billableAmt : 0,
      invoicedShare: billable > 0 ? billedHours / billable : 0,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      {/* Period controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-stone-400 dark:text-stone-500">From</span>
          <MonthSelect value={fromMonth} onChange={setFromMonth} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-stone-400 dark:text-stone-500">To</span>
          <MonthSelect value={toMonth} onChange={setToMonth} />
        </div>
        {data?.monthCount ? (
          <span className="text-[11px] text-stone-400 dark:text-stone-500">
            {data.monthCount} month{data.monthCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={Gauge}
          label="Avg Utilization"
          value={`${(totals.avgUtilization * 100).toFixed(0)}%`}
          hint={`${totals.billable.toFixed(0)} / ${totals.capacity.toFixed(0)} hrs`}
        />
        <KpiCard
          icon={TrendingUp}
          label="Firm Realization"
          value={totals.firmRealization > 0 ? `${(totals.firmRealization * 100).toFixed(0)}%` : '—'}
          hint={`${formatPHP(totals.billed)} of ${formatPHP(totals.billableAmt)}`}
        />
        <KpiCard
          icon={Wallet}
          label="Billed Revenue"
          value={formatPHP(totals.billed)}
          hint="sent + paid invoices in range"
        />
        <KpiCard
          icon={Gauge}
          label="Billable Hours"
          value={totals.billable.toFixed(0)}
          hint={`${totals.billedHours.toFixed(0)} invoiced · ${totals.worked.toFixed(0)} worked`}
        />
      </div>

      {/* Unmapped warning */}
      {data?.unmappedLawyerCount ? (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {data.unmappedLawyerCount} DTR name(s) did not match any active team member. Their hours were dropped from the table. Check server logs and fix the team.name spelling or activate the row.
          </span>
        </div>
      ) : null}

      {/* Loading / error / empty */}
      {isLoading && !data && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 text-gold-500 animate-spin dark:text-gold-400" />
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">Failed to load utilization data.</div>
      )}
      {data && rows.length === 0 && (
        <div className="text-center py-12 text-sm text-stone-400 dark:text-stone-500">
          No utilization data for this period.
        </div>
      )}

      {/* Per-lawyer rows */}
      {rows.length > 0 && (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-stone-400 dark:text-stone-500 bg-stone-50/50 dark:bg-stone-800/30 border-b border-[var(--border-color)]">
            <div className="col-span-3">Lawyer</div>
            <div className="col-span-3">Billable Utilization</div>
            <div className="col-span-2 text-right">Billed Revenue</div>
            <div className="col-span-2 text-right">Realization</div>
            <div className="col-span-2 text-right">Eff. Rate / Hr</div>
          </div>
          <div className="divide-y divide-stone-100 dark:divide-stone-800/50">
            {rows.map((r) => {
              const tone = utilizationTone(r.billableUtilization);
              const pct = Math.min(r.billableUtilization, 1.5) / 1.5 * 100;
              return (
                <div key={r.lawyerName} className="grid grid-cols-1 md:grid-cols-12 gap-3 px-4 py-3 items-center">
                  <div className="md:col-span-3">
                    <div className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">{r.lawyerName}</div>
                    <div className="text-[11px] text-stone-400 dark:text-stone-500">{r.position}</div>
                  </div>
                  <div className="md:col-span-3 flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                      <div className={`h-full ${tone.bar} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-baseline gap-1 shrink-0 w-32 justify-end">
                      <span className={`text-sm font-semibold tabular-nums ${tone.text}`}>
                        {(r.billableUtilization * 100).toFixed(0)}%
                      </span>
                      <span className="text-[10px] text-stone-400 dark:text-stone-500 tabular-nums">
                        {r.billableHours.toFixed(0)}/{r.capacityHours.toFixed(0)}h
                      </span>
                    </div>
                  </div>
                  <div className="md:col-span-2 text-right">
                    <div className="text-sm font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                      {formatPHP(r.billedAmount)}
                    </div>
                  </div>
                  <div className="md:col-span-2 text-right">
                    <div className={`text-sm font-semibold tabular-nums ${realizationTone(r.realizationRate)}`}>
                      {r.realizationRate > 0 ? `${(r.realizationRate * 100).toFixed(0)}%` : '—'}
                    </div>
                    <div className="text-[10px] text-stone-400 dark:text-stone-500 tabular-nums">
                      of {formatPHP(r.billableAmount)}
                    </div>
                  </div>
                  <div className="md:col-span-2 text-right">
                    <div className="text-sm font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                      {r.effectiveRate > 0 ? formatPHP(r.effectiveRate) : '—'}
                    </div>
                    <div className="text-[10px] text-stone-400 dark:text-stone-500">per worked hr</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-[11px] text-stone-400 dark:text-stone-500 space-y-1">
        <p>
          <strong>Billable hours</strong> = post-revision DTR with <code>non_billable = false</code> (eligible to invoice).
          <strong className="ml-2">Billed hours</strong> = subset already on a sent/paid invoice.
        </p>
        <p>
          <strong>Billable utilization</strong> = billable ÷ position capacity ({totals.capacity > 0 ? 'baseline × selected months' : 'baseline'}).
          <strong className="ml-2">Realization</strong> = invoiced amount ÷ (billable hours × position rate).
          Hours are fanned across attendees so meetings credit every lawyer present.
        </p>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, hint }: { icon: typeof Gauge; label: string; value: string; hint: string }) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-stone-400 dark:text-stone-500">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="mt-1 font-serif text-2xl font-bold tabular-nums text-stone-800 dark:text-stone-100">{value}</div>
      <div className="text-[11px] text-stone-400 dark:text-stone-500 truncate" title={hint}>{hint}</div>
    </div>
  );
}
