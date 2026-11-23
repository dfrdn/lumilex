'use client';

import { useState, useEffect } from 'react';
import {
  Clock,
  FileText,
  AlertCircle,
  Scale,
  Files,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return value;
}

interface Props {
  totalDTRHours: number;
  activeDeliverables: number;
  overdueDeliverables: number;
  totalHearings: number;
  totalFilings: number;
  previousValues?: number[]; // YoY: same order as values
}

const cards = [
  {
    key: 'dtr',
    label: 'Total DTR Hours',
    icon: Clock,
    format: (v: number) => v.toFixed(1),
    color: 'text-gold-500 dark:text-gold-400',
    bg: 'bg-gold-50 dark:bg-gold-500/10',
    decimal: true,
  },
  {
    key: 'deliverables',
    label: 'Active Deliverables',
    icon: FileText,
    format: (v: number) => String(Math.round(v)),
    color: 'text-stone-500 dark:text-stone-400',
    bg: 'bg-stone-50 dark:bg-stone-500/10',
    decimal: false,
  },
  {
    key: 'overdue',
    label: 'Overdue',
    icon: AlertCircle,
    format: (v: number) => String(Math.round(v)),
    color: 'text-red-500 dark:text-red-400',
    colorZero: 'text-stone-400 dark:text-stone-500',
    bg: 'bg-red-50 dark:bg-red-500/10',
    bgZero: 'bg-stone-50 dark:bg-stone-500/10',
    decimal: false,
  },
  {
    key: 'hearings',
    label: 'Hearings',
    icon: Scale,
    format: (v: number) => String(Math.round(v)),
    color: 'text-gold-600 dark:text-gold-400',
    bg: 'bg-gold-50/60 dark:bg-gold-500/10',
    decimal: false,
  },
  {
    key: 'filings',
    label: 'Filings',
    icon: Files,
    format: (v: number) => String(Math.round(v)),
    color: 'text-stone-400 dark:text-stone-500',
    bg: 'bg-stone-50 dark:bg-stone-500/10',
    decimal: false,
  },
] as const;

export default function FirmSummaryCards({
  totalDTRHours,
  activeDeliverables,
  overdueDeliverables,
  totalHearings,
  totalFilings,
  previousValues,
}: Props) {
  const values = [totalDTRHours, activeDeliverables, overdueDeliverables, totalHearings, totalFilings];

  // Animate each value
  const animated = [
    useCountUp(values[0]),
    useCountUp(values[1]),
    useCountUp(values[2]),
    useCountUp(values[3]),
    useCountUp(values[4]),
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 stagger-children">
      {cards.map((card, i) => {
        const Icon = card.icon;
        const isZero = values[i] === 0;
        const iconColor = 'colorZero' in card && isZero ? card.colorZero : card.color;
        const iconBg = 'bgZero' in card && isZero ? card.bgZero : card.bg;

        // YoY delta
        const prev = previousValues?.[i];
        const delta = prev !== undefined && prev > 0
          ? ((values[i] - prev) / prev) * 100
          : undefined;

        return (
          <div
            key={card.key}
            className="bg-card rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] action-lift p-4 sm:p-5 animate-fade-up"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className={`${iconBg} rounded-lg p-1.5`}>
                <Icon className={`w-4 h-4 ${iconColor}`} />
              </div>
              <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {card.label}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <p className={`text-2xl font-bold tabular-nums ${
                card.key === 'overdue' && !isZero ? 'text-red-600 dark:text-red-400' : 'text-foreground'
              }`}>
                {card.decimal ? animated[i].toFixed(1) : String(Math.round(animated[i]))}
              </p>
              {delta !== undefined && (
                <span className={`text-[10px] font-semibold flex items-center gap-0.5 mb-1 ${
                  delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
                }`}>
                  {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
