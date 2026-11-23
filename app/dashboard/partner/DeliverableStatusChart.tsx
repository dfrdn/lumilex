'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

interface Props {
  data: { status: string; count: number }[];
  total: number;
  overdueCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  [DELIVERABLE_STATUS.NOT_STARTED]:        '#9ca3af',
  [DELIVERABLE_STATUS.DRAFTING]:           '#3b82f6',
  [DELIVERABLE_STATUS.UNDER_REVIEW]:       '#f97316',
  'For Initial Review': '#f97316',
  [DELIVERABLE_STATUS.REVISING]:           '#a855f7',
  'For Revision':       '#a855f7',
  [DELIVERABLE_STATUS.FINALIZING]:         '#ef4444',
  [DELIVERABLE_STATUS.PRE_FINALIZED]:      '#ec4899',
  'For Final Review':   '#7c3aed',
  [DELIVERABLE_STATUS.AWAITING_CLIENT]:    '#f59e0b',
  [DELIVERABLE_STATUS.OUTBOX]:             '#14b8a6',
  'Ready to File':      '#14b8a6',
};

const FALLBACK_COLORS = ['#fbbf24', '#d97706', '#78716c', '#f59e0b', '#a8a29e', '#92400e', '#e7e5e4'];

function getColor(status: string, index: number): string {
  return STATUS_COLORS[status] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function CustomTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: { status: string; count: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const { status, count } = payload[0].payload;
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-2 text-sm dark:bg-stone-900 dark:border-stone-700">
      <p className="font-medium text-stone-600 text-xs dark:text-stone-300">{status}</p>
      <p className="text-gold-600 font-semibold tabular-nums mt-0.5 dark:text-gold-400">{count}</p>
    </div>
  );
}

export default function DeliverableStatusChart({ data, total, overdueCount }: Props) {
  if (data.length === 0 || total === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
        <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Deliverable Status</h3>
        <div className="h-64 sm:h-72 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
          No active deliverables
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
      <h3 className="text-sm font-semibold text-stone-700 mb-4 dark:text-stone-200">Deliverable Status</h3>
      <div className="h-56 sm:h-64 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="45%"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={2}
              dataKey="count"
              nameKey="status"
              stroke="none"
            >
              {data.map((entry, i) => (
                <Cell key={entry.status} fill={getColor(entry.status, i)} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: '10%' }}>
          <div className="text-center">
            <p className="text-xl font-bold text-stone-800 tabular-nums dark:text-stone-100">{total}</p>
            <p className="text-[10px] text-stone-400 uppercase tracking-wider dark:text-stone-500">active</p>
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 justify-center">
        {data.map((item, i) => (
          <div key={item.status} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: getColor(item.status, i) }}
            />
            <span className="text-xs text-stone-500 dark:text-stone-400">{item.status}</span>
            <span className="text-xs text-stone-400 tabular-nums dark:text-stone-500">({item.count})</span>
          </div>
        ))}
      </div>
      {overdueCount > 0 && (
        <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200/80 rounded-lg text-xs text-red-700 font-semibold text-center dark:bg-red-500/10 dark:text-red-300 dark:border-red-400/30">
          {overdueCount} overdue deliverable{overdueCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
