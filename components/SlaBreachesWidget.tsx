'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { OpenBreach } from '@/lib/queries/sla-breaches';

const SEVERITY_TONE: Record<string, string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  normal: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  low: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SlaBreachesWidget({
  breaches,
  limit = 5,
}: {
  breaches: OpenBreach[];
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (breaches.length === 0) return null;

  const shown = expanded ? breaches : breaches.slice(0, limit);
  const more = breaches.length - limit;

  return (
    <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          SLA breaches
        </h3>
        <span className="text-[11px] text-amber-700 dark:text-amber-400">
          {breaches.length} unresolved
        </span>
      </div>
      <ul className="space-y-1.5">
        {shown.map((b) => (
          <li key={b.id}>
            <Link
              href={`/dashboard/deliverables/${b.deliverableId}`}
              className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-amber-100/60 dark:hover:bg-amber-900/20 group cursor-pointer"
            >
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${SEVERITY_TONE[b.severity] ?? SEVERITY_TONE.normal}`}>
                {b.severity}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-stone-800 dark:text-stone-200 truncate">
                  {b.deliverableName || '(Untitled)'}
                </div>
                <div className="text-[11px] text-stone-500 dark:text-stone-400">
                  {b.ruleName} · {b.breachType} · {formatRelative(b.detectedAt)}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-300 dark:text-stone-600 group-hover:text-stone-500 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="mt-2 px-2 py-1 -ml-2 rounded-md text-[11px] text-amber-700 dark:text-amber-400 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 hover:underline cursor-pointer"
        >
          {expanded ? 'Show less' : `+ ${more} more`}
        </button>
      )}
    </div>
  );
}
