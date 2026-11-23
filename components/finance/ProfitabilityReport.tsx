'use client';

import { useState } from 'react';
import {
  TrendingUp, ChevronDown, ChevronRight, Loader2,
  DollarSign, Briefcase, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import type { MatterProfit } from '@/lib/finance/profitability';
import { fmt, fmtPct, MarginBadge } from '@/lib/finance/format';
import useSWR from 'swr';

export default function ProfitabilityReport() {
  const { data: json, isLoading: loading } = useSWR<{
    matters?: MatterProfit[]; totalRevenue?: number; totalCost?: number; totalProfit?: number; avgMargin?: number;
  }>('/api/finance/profitability');
  const matters = json?.matters ?? [];
  const totalRevenue = json?.totalRevenue ?? 0;
  const totalCost = json?.totalCost ?? 0;
  const totalProfit = json?.totalProfit ?? 0;
  const avgMargin = json?.avgMargin ?? 0;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'revenue' | 'profit' | 'margin'>('revenue');


  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  const sorted = [...matters].sort((a, b) => {
    if (sortBy === 'revenue') return b.revenue - a.revenue;
    if (sortBy === 'profit') return b.profit - a.profit;
    return b.margin - a.margin;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Matter Profitability</h1>
          <p className="text-sm text-[var(--text-muted)]">Revenue vs cost analysis per matter</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Revenue" value={fmt(totalRevenue)} icon={DollarSign} color="emerald" />
        <SummaryCard label="Total Cost" value={fmt(totalCost)} icon={Briefcase} color="blue" />
        <SummaryCard
          label="Total Profit"
          value={`${totalProfit < 0 ? '-' : ''}${fmt(totalProfit)}`}
          icon={totalProfit >= 0 ? ArrowUpRight : ArrowDownRight}
          color={totalProfit >= 0 ? 'emerald' : 'red'}
        />
        <SummaryCard label="Avg Margin" value={fmtPct(avgMargin)} icon={TrendingUp} color={avgMargin >= 20 ? 'emerald' : 'amber'} />
      </div>

      {/* Matter Table */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Per-Matter Breakdown</h2>
          <div className="flex items-center gap-1 bg-subtle rounded-lg p-0.5">
            {(['revenue', 'profit', 'margin'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSortBy(s)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-all cursor-pointer capitalize ${
                  sortBy === s
                    ? 'bg-card text-foreground shadow-sm border border-[var(--border-color)]'
                    : 'text-[var(--text-muted)] hover:text-foreground'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-[var(--text-muted)]">
            No profitability data available
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]">
            {/* Header Row */}
            <div className="grid grid-cols-[1fr_90px_90px_90px_90px_60px] gap-2 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <span>Matter</span>
              <span className="text-right">Revenue</span>
              <span className="text-right">Labor</span>
              <span className="text-right">Expenses</span>
              <span className="text-right">Profit</span>
              <span className="text-right">Margin</span>
            </div>

            {sorted.map((m) => {
              const isExpanded = expanded.has(m.matterId);
              return (
                <div key={m.matterId}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(m.matterId)}
                    className="w-full grid grid-cols-[1fr_90px_90px_90px_90px_60px] gap-2 px-5 py-3 items-center hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 text-left">
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{m.matterName}</p>
                        <p className="text-[10px] text-[var(--text-muted)] truncate">{m.clientName}</p>
                      </div>
                    </div>
                    <span className="text-xs text-right tabular-nums text-[var(--text-secondary)]">{fmt(m.revenue)}</span>
                    <span className="text-xs text-right tabular-nums text-[var(--text-muted)]">{fmt(m.laborCost)}</span>
                    <span className="text-xs text-right tabular-nums text-[var(--text-muted)]">{fmt(m.expenseCost)}</span>
                    <span className={`text-xs text-right font-semibold tabular-nums ${m.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {m.profit < 0 ? '-' : ''}{fmt(m.profit)}
                    </span>
                    <div className="text-right">
                      <MarginBadge margin={m.margin} />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="bg-subtle/50 px-5 py-3 border-t border-[var(--border-color)]">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Lawyer Breakdown */}
                        {m.lawyerBreakdown.length > 0 && (
                          <div>
                            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Labor by Lawyer</h4>
                            <div className="space-y-1.5">
                              {m.lawyerBreakdown.map((l) => (
                                <div key={l.name} className="flex items-center justify-between text-[11px]">
                                  <span className="text-[var(--text-secondary)] truncate">{l.name}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-[var(--text-muted)] font-mono tabular-nums">{l.hours.toFixed(1)}h</span>
                                    <span className="text-[var(--text-secondary)] tabular-nums w-20 text-right">{fmt(l.laborCost)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Expense Breakdown */}
                        {m.expenseBreakdown.length > 0 && (
                          <div>
                            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Expenses by Category</h4>
                            <div className="space-y-1.5">
                              {m.expenseBreakdown.map((e) => (
                                <div key={e.category} className="flex items-center justify-between text-[11px]">
                                  <span className="text-[var(--text-secondary)]">{e.category}</span>
                                  <span className="text-[var(--text-secondary)] tabular-nums">{fmt(e.amount)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: typeof DollarSign; color: string;
}) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 dark:text-emerald-400',
    blue: 'bg-blue-50 dark:bg-blue-500/10 text-blue-500',
    red: 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400',
    amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-500',
  };
  const c = colors[color] ?? colors.emerald;

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg ${c.split(' ').slice(0, 2).join(' ')} flex items-center justify-center`}>
          <Icon className={`w-3.5 h-3.5 ${c.split(' ').pop()}`} />
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      </div>
      <p className="text-xl font-bold text-foreground tabular-nums">{value}</p>
    </div>
  );
}
