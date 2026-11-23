'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface Props {
  data: { period: string; hearings: number; filings: number }[];
  view: 'monthly' | 'yearly';
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-2 text-sm dark:bg-stone-900 dark:border-stone-700">
      <p className="font-medium text-stone-600 text-xs mb-1 dark:text-stone-300">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="tabular-nums" style={{ color: p.stroke }}>
          <span className="font-semibold">{p.value}</span>{' '}
          <span className="text-stone-400 text-xs dark:text-stone-500">{p.dataKey}</span>
        </p>
      ))}
    </div>
  );
}

export default function HearingFilingTrendChart({ data, view }: Props) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
        <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Hearings & Filings Trend</h3>
        <div className="h-64 sm:h-72 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
          No hearing or filing data for this period
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
      <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Hearings & Filings Trend</h3>
      <div className="h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
            <defs>
              <linearGradient id="hearingsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="filingsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#78716c" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#78716c" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 11, fill: '#a8a29e' }}
              tickLine={false}
              axisLine={{ stroke: '#e7e5e4' }}
              interval={view === 'monthly' ? 0 : undefined}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#a8a29e' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: '#78716c' }}
            />
            <Area
              type="monotone"
              dataKey="hearings"
              stroke="#d97706"
              strokeWidth={2}
              fill="url(#hearingsGrad)"
              name="Hearings"
            />
            <Area
              type="monotone"
              dataKey="filings"
              stroke="#57534e"
              strokeWidth={2}
              fill="url(#filingsGrad)"
              name="Filings"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
