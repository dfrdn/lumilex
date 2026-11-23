'use client';

import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import {
  GRID_COLUMNS,
  shortDate,
  type ComplianceGridRow,
  type GridColumn,
  type ItemState,
  type StatusItem,
} from '@/lib/corporations/status';

const COLUMN_LABEL: Record<GridColumn, string> = {
  gis: 'GIS',
  afs: 'AFS',
  itr: 'Income tax',
  bo: 'BO declaration',
  asm: 'Annual meeting',
};

export const STATE_STYLE: Record<ItemState, { label: string; cls: string }> = {
  done: { label: 'Done', cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' },
  filed: { label: 'Filed', cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' },
  in_progress: { label: 'In progress', cls: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30' },
  waiting_on_client: { label: 'Waiting on client', cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' },
  not_started: { label: 'Not started', cls: 'bg-white dark:bg-card text-stone-600 dark:text-stone-300 border-stone-200 dark:border-white/10' },
  overdue: { label: 'Overdue', cls: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30' },
  not_ours: { label: 'Not ours', cls: 'bg-stone-50 dark:bg-white/5 text-stone-400 dark:text-stone-500 border-stone-200 dark:border-white/10' },
};

function Cell({ item }: { item: StatusItem }) {
  const style = STATE_STYLE[item.state];
  const date = item.dueDate ? shortDate(item.dueDate) : null;
  const title = [item.detail, item.provisional ? 'Provisional — this year’s deadline is not in the filing calendar yet' : null]
    .filter(Boolean)
    .join(' · ');
  const body = (
    <div className={`h-full rounded-lg border px-2 py-1.5 ${style.cls}`} title={title || undefined}>
      <div className="text-[11px] font-medium">{style.label}</div>
      {date && item.state !== 'not_ours' && (
        <div className={`text-[10px] tabular-nums opacity-80 ${item.provisional ? 'italic' : ''}`}>
          {item.state === 'done' || item.state === 'filed' ? date : `due ${date}`}
          {item.provisional && ' (prov.)'}
        </div>
      )}
      {item.detail && item.state !== 'done' && <div className="text-[10px] opacity-80 truncate">{item.detail}</div>}
    </div>
  );
  return item.deliverableId ? (
    <Link href={`/dashboard/deliverables/${item.deliverableId}`} className="block h-full hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Fiscal year × recurring obligation. Each cell is the status engine's reading
 * of that filing or meeting — the same one the track cards and the registry
 * use — so a gap in the record shows here as a red cell, not a blank.
 */
export default function ComplianceGrid({ rows }: { rows: ComplianceGridRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl px-5 py-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Filings by year</h3>
        <Link
          href="/dashboard/corporations/calendar"
          className="inline-flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
        >
          <CalendarDays className="w-3 h-3" /> Filing calendar
        </Link>
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full border-separate border-spacing-1 text-left">
          <thead>
            <tr>
              <th className="w-20 text-[11px] font-medium text-stone-500 dark:text-stone-400 px-1">Fiscal year</th>
              {GRID_COLUMNS.map((k) => (
                <th key={k} className="text-[11px] font-medium text-stone-500 dark:text-stone-400 px-1 min-w-[7.5rem]">
                  {COLUMN_LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.fy}>
                <td className="text-xs font-medium text-stone-700 dark:text-stone-200 px-1 align-top pt-2">FY {r.fy}</td>
                {GRID_COLUMNS.map((k) => (
                  <td key={k} className="align-top">
                    <Cell item={r.cells[k]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
