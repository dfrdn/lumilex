'use client';

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fmt, fmtPct, fmtCompact } from '@/lib/finance/format';
import type { Month } from './FinanceOverview';

const axisTick = { fontSize: 11, fill: '#a8a29e' };

export default function FinanceOverviewChart({ months, onMonthClick }: { months: Month[]; onMonthClick: (month: string) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onBarClick = (entry: any) => {
    const m = entry?.payload?.month ?? entry?.month;
    if (typeof m === 'string') onMonthClick(m);
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={months} margin={{ top: 5, right: 5, bottom: 5, left: 5 }} className="cursor-pointer">
        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
        <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} interval={0} />
        <YAxis yAxisId="peso" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtCompact(v)} width={56} />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={40} />
        <Tooltip content={<OverviewTooltip />} cursor={{ fill: '#f5f5f4', opacity: 0.5 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="peso" name="Collected" dataKey="collected" fill="#34d399" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} onClick={onBarClick} />
        <Bar yAxisId="peso" name="Operating expenses" dataKey="opex" fill="#fb923c" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} onClick={onBarClick} />
        <Line yAxisId="pct" name="Collection rate" dataKey="collectionRate" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3, fill: '#8b5cf6' }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OverviewTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-2 text-xs dark:bg-stone-900 dark:border-stone-700">
      <p className="font-medium text-stone-600 dark:text-stone-300 mb-1">{label}</p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.filter((p: any) => p.value != null).map((p: any) => (
        <p key={p.dataKey} className="tabular-nums flex items-center justify-between gap-3" style={{ color: p.color || p.stroke || p.fill }}>
          <span>{p.name}</span>
          <span className="font-semibold">{p.dataKey === 'collectionRate' ? fmtPct(Number(p.value)) : fmt(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}
