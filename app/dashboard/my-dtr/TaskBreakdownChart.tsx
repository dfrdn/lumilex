'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export interface TaskData {
  name: string;
  hours: number;
}

interface Props {
  data: TaskData[];
  totalHours: number;
}

const COLORS = ['#fbbf24', '#d97706', '#78716c', '#f59e0b', '#a8a29e', '#92400e', '#e7e5e4'];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { name, hours } = payload[0].payload;
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-2 text-sm dark:bg-stone-900 dark:border-stone-700">
      <p className="font-medium text-stone-600 dark:text-stone-300 text-xs">{name}</p>
      <p className="text-gold-600 dark:text-gold-400 font-semibold tabular-nums mt-0.5">
        {hours.toFixed(1)}h
      </p>
    </div>
  );
}

export default function TaskBreakdownChart({ data, totalHours }: Props) {
  // Group small categories into "Other"
  const MAX_SLICES = 6;
  let chartData = data;
  if (data.length > MAX_SLICES) {
    const top = data.slice(0, MAX_SLICES - 1);
    const rest = data.slice(MAX_SLICES - 1);
    const otherHours = rest.reduce((sum, d) => sum + d.hours, 0);
    chartData = [...top, { name: 'Other', hours: otherHours }];
  }

  if (chartData.length === 0 || totalHours === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-800">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-4">Hours by Task</h3>
        <div className="h-56 sm:h-64 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
          No data for this month
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-800">
      <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-4">Hours by Task</h3>
      <div className="h-56 sm:h-64 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="45%"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={2}
              dataKey="hours"
              nameKey="name"
              stroke="none"
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: '10%' }}>
          <div className="text-center">
            <p className="text-xl font-bold text-stone-800 dark:text-stone-100 tabular-nums">{totalHours.toFixed(1)}</p>
            <p className="text-[10px] text-stone-400 dark:text-stone-500 uppercase tracking-wider">hours</p>
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 justify-center">
        {chartData.map((item, i) => (
          <div key={item.name} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-xs text-stone-500 dark:text-stone-400">{item.name}</span>
            <span className="text-xs text-stone-400 dark:text-stone-500 tabular-nums">
              ({((item.hours / totalHours) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
