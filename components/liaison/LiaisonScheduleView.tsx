'use client';

import { useMemo, useState } from 'react';
import { MapPin, Clock } from 'lucide-react';
import type { LiaisonTask } from '@/lib/queries/liaison';

interface Props {
  tasks: LiaisonTask[];
}

function pad(n: number) { return n.toString().padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(s: string, n: number) {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDay(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

const STATUS_BG: Record<string, string> = {
  pending: 'bg-stone-100 dark:bg-stone-800/50',
  in_progress: 'bg-blue-50 dark:bg-blue-900/20',
  completed: 'bg-emerald-50 dark:bg-emerald-900/15',
  cancelled: 'bg-stone-50 dark:bg-stone-900/30 opacity-60',
};

export default function LiaisonScheduleView({ tasks }: Props) {
  const [range, setRange] = useState<'today' | 'week' | 'all'>('week');

  const days = useMemo(() => {
    const t = todayStr();
    if (range === 'today') return [t];
    if (range === 'week') return Array.from({ length: 7 }, (_, i) => addDays(t, i));
    return null;
  }, [range]);

  const grouped = useMemo(() => {
    const map = new Map<string, LiaisonTask[]>();
    for (const t of tasks) {
      const key = t.scheduled_for ?? 'unscheduled';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [tasks]);

  const visibleDays = days ?? Array.from(grouped.keys()).filter((k) => k !== 'unscheduled').sort();
  const unscheduled = grouped.get('unscheduled') ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 bg-[var(--subtle-bg)] rounded-lg p-0.5 w-fit mb-6">
        {(['today', 'week', 'all'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
              range === r
                ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {r === 'today' ? 'Today' : r === 'week' ? 'Next 7 days' : 'All scheduled'}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {visibleDays.map((day) => {
          const items = grouped.get(day) ?? [];
          if (items.length === 0 && range !== 'all') {
            return (
              <DayBlock key={day} day={day} items={[]} />
            );
          }
          return <DayBlock key={day} day={day} items={items} />;
        })}

        {range === 'all' && unscheduled.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">
              Unscheduled
            </div>
            <div className="space-y-2">
              {unscheduled.map((t) => <ErrandRow key={t.id} task={t} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DayBlock({ day, items }: { day: string; items: LiaisonTask[] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2 flex items-center gap-2">
        <Clock className="w-3 h-3" />
        {fmtDay(day)}
        <span className="text-stone-300 dark:text-stone-500 font-normal">
          · {items.length} errand{items.length === 1 ? '' : 's'}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-stone-400 dark:text-stone-500 italic px-3 py-2">
          Nothing scheduled.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((t) => <ErrandRow key={t.id} task={t} />)}
        </div>
      )}
    </div>
  );
}

function ErrandRow({ task }: { task: LiaisonTask }) {
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] ${STATUS_BG[task.status] ?? ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-medium text-foreground text-sm">{task.title}</div>
          <span className="text-[10px] uppercase tracking-wider text-stone-400">
            {task.status.replace('_', ' ')}
          </span>
        </div>
        {task.purpose && (
          <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 line-clamp-2">
            {task.purpose}
          </div>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-stone-500 dark:text-stone-400">
          <span className="font-medium text-foreground">{task.assigned_to_name}</span>
          {task.zone_name && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {task.zone_name}
              {task.zone_round_trip_rate != null && (
                <span className="text-stone-400">
                  · ₱{Number(task.zone_round_trip_rate).toLocaleString('en-PH')}
                </span>
              )}
            </span>
          )}
          {task.matter_name && <span>· {task.matter_name}</span>}
        </div>
      </div>
    </div>
  );
}
