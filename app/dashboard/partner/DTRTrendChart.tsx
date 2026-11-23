'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface Props {
  data: { period: string; hours: number }[];
  view: 'monthly' | 'yearly';
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { period, hours } = payload[0].payload;
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-2 text-sm dark:bg-stone-900 dark:border-stone-700">
      <p className="font-medium text-stone-600 text-xs dark:text-stone-300">{period}</p>
      <p className="text-gold-600 font-semibold tabular-nums mt-0.5 dark:text-gold-400">
        {hours.toFixed(1)} hrs
      </p>
    </div>
  );
}

export default function DTRTrendChart({ data, view }: Props) {
  const maxHours = Math.max(...data.map((d) => d.hours), 1);
  const avgHours = data.length > 0 ? data.reduce((s, d) => s + d.hours, 0) / data.length : 0;

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
        <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Firm Hours Trend</h3>
        <div className="h-64 sm:h-72 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
          No DTR data for this period
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
      <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Firm Hours Trend</h3>
      <div className="h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
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
              domain={[0, Math.ceil(maxHours * 1.15)]}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#fef3c7', opacity: 0.5 }} />
            {avgHours > 0 && (
              <ReferenceLine
                y={Math.round(avgHours * 10) / 10}
                stroke="#d6d3d1"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `avg ${avgHours.toFixed(0)}h`,
                  position: 'insideTopRight',
                  fill: '#a8a29e',
                  fontSize: 10,
                }}
              />
            )}
            <Bar
              dataKey="hours"
              fill="#fbbf24"
              radius={[3, 3, 0, 0]}
              maxBarSize={view === 'yearly' ? 48 : 32}
              activeBar={{ fill: '#f59e0b' }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
