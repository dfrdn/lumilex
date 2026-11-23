'use client';

import {
  Clock,
  CalendarDays,
  BarChart3,
  FileText,
} from 'lucide-react';

interface Props {
  totalHours: number;
  workingDays: number;
  avgHoursPerDay: number;
  entryCount: number;
}

const cards = [
  {
    key: 'hours',
    label: 'Total Hours',
    icon: Clock,
    format: (v: number) => v.toFixed(1),
    color: 'text-gold-500 dark:text-gold-400',
    bg: 'bg-gold-50 dark:bg-gold-500/10',
  },
  {
    key: 'days',
    label: 'Working Days',
    icon: CalendarDays,
    format: (v: number) => String(v),
    color: 'text-stone-500 dark:text-stone-400',
    bg: 'bg-stone-50 dark:bg-stone-800',
  },
  {
    key: 'avg',
    label: 'Avg Hours / Day',
    icon: BarChart3,
    format: (v: number) => v.toFixed(1),
    color: 'text-gold-600 dark:text-gold-400',
    bg: 'bg-gold-50/60 dark:bg-gold-500/10',
  },
  {
    key: 'entries',
    label: 'Total Entries',
    icon: FileText,
    format: (v: number) => String(v),
    color: 'text-stone-400 dark:text-stone-500',
    bg: 'bg-stone-50 dark:bg-stone-800',
  },
] as const;

export default function SummaryStats({ totalHours, workingDays, avgHoursPerDay, entryCount }: Props) {
  const values = [totalHours, workingDays, avgHoursPerDay, entryCount];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 page-stagger">
      {cards.map((card, i) => {
        const Icon = card.icon;
        return (
          <div
            key={card.key}
            className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-4 sm:p-5 hover-lift"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className={`${card.bg} rounded-lg p-1.5`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
              <span className="text-[11px] font-medium text-stone-400 uppercase tracking-wider dark:text-stone-500">
                {card.label}
              </span>
            </div>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {card.format(values[i])}
            </p>
          </div>
        );
      })}
    </div>
  );
}
