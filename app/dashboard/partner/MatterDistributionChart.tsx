'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface Props {
  data: { name: string; initials: string; count: number }[];
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { name, count } = payload[0].payload;
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-2 text-sm dark:bg-stone-900 dark:border-stone-700">
      <p className="font-medium text-stone-600 text-xs dark:text-stone-300">{name}</p>
      <p className="text-gold-600 font-semibold tabular-nums mt-0.5 dark:text-gold-400">
        {count} matter{count !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

export default function MatterDistributionChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
        <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Matters by Lawyer</h3>
        <div className="h-64 sm:h-72 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
          No matter data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
      <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Matters by Lawyer</h3>
      <div className="h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
            <XAxis
              dataKey="initials"
              tick={{ fontSize: 11, fill: '#a8a29e' }}
              tickLine={false}
              axisLine={{ stroke: '#e7e5e4' }}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#a8a29e' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#fef3c7', opacity: 0.5 }} />
            <Bar
              dataKey="count"
              fill="#fbbf24"
              radius={[3, 3, 0, 0]}
              maxBarSize={32}
              activeBar={{ fill: '#f59e0b' }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
