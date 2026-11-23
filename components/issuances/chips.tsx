'use client';

import { AlertTriangle } from 'lucide-react';
import { SOURCES, type SourceKey } from '@/lib/issuances/sources';

const SOURCE_COLORS: Record<SourceKey, string> = {
  sc:   'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  doj:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  bir:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  sec:  'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  bsp:  'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  ipo:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  npc:  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  amlc: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
};

export function SourceBadge({ source }: { source: SourceKey }) {
  const meta = SOURCES[source];
  return (
    <span
      className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${SOURCE_COLORS[source]}`}
      title={meta?.label}
    >
      {meta?.shortLabel ?? source.toUpperCase()}
    </span>
  );
}

export function ConfidenceChip({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  if (confidence === 'high') return null;
  if (confidence === 'medium') {
    return (
      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded text-stone-500 bg-stone-100 dark:bg-stone-800 dark:text-stone-400">
        AI · medium
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      <AlertTriangle className="w-2.5 h-2.5" />
      Needs review
    </span>
  );
}
