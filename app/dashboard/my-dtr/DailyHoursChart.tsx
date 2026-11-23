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

export interface DayData {
  day: number;
  date: string;
  hours: number;
}

interface Props {
  data: DayData[];
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { date, hours } = payload[0].payload;
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-2 text-sm dark:bg-stone-900 dark:border-stone-700">
      <p className="font-medium text-stone-600 dark:text-stone-300 text-xs">{dateLabel}</p>
      <p className="text-gold-600 dark:text-gold-400 font-semibold tabular-nums mt-0.5">
        {hours.toFixed(1)} hrs
      </p>
    </div>
  );
}

export default function DailyHoursChart({ data }: Props) {
  const maxHours = Math.max(...data.map((d) => d.hours), 8);

  return (
    <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-800">
      <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-4">Daily Hours</h3>
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e7e5e4"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11, fill: '#a8a29e' }}
              tickLine={false}
              axisLine={{ stroke: '#e7e5e4' }}
              interval={data.length > 20 ? 1 : 0}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#a8a29e' }}
              tickLine={false}
              axisLine={false}
              domain={[0, Math.ceil(maxHours + 1)]}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#fef3c7', opacity: 0.5 }} />
            <ReferenceLine
              y={8}
              stroke="#d6d3d1"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: '8h target',
                position: 'insideTopRight',
                fill: '#a8a29e',
                fontSize: 10,
              }}
            />
            <Bar
              dataKey="hours"
              fill="#fbbf24"
              radius={[3, 3, 0, 0]}
              maxBarSize={24}
              activeBar={{ fill: '#f59e0b' }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
