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
  data: { name: string; count: number }[];
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { name, count } = payload[0].payload;
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-2 text-sm dark:bg-stone-900 dark:border-stone-700">
      <p className="font-medium text-stone-600 text-xs dark:text-stone-300">{name}</p>
      <p className="text-stone-800 font-semibold tabular-nums mt-0.5 dark:text-stone-100">
        {count} matter{count !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

export default function MatterClientChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
        <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Top Clients by Matters</h3>
        <div className="h-64 sm:h-72 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
          No matter data available
        </div>
      </div>
    );
  }

  const chartHeight = Math.max(data.length * 32, 200);

  return (
    <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
      <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Top Clients by Matters</h3>
      <div style={{ height: Math.min(chartHeight, 360) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: '#a8a29e' }}
              tickLine={false}
              axisLine={{ stroke: '#e7e5e4' }}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10, fill: '#78716c' }}
              tickLine={false}
              axisLine={false}
              width={140}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#fef3c7', opacity: 0.5 }} />
            <Bar
              dataKey="count"
              fill="#a8a29e"
              radius={[0, 3, 3, 0]}
              maxBarSize={20}
              activeBar={{ fill: '#78716c' }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
