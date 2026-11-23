'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function DateChip({ date }: { date: string | null }) {
  if (!date) return null;

  // Pin to UTC midnight and format in Manila — otherwise a date stored as
  // 2026-04-20 gets parsed as Manila midnight (= 2026-04-19 16:00 UTC) and
  // rendered as UTC, silently shifting the display to Apr 19.
  const d = new Date(date + 'T00:00:00Z');

  const [today, setToday] = useState('');
  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }));
  }, []);

  const isOverdue = today ? date < today : false;

  const label = d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });

  return (
    <span
      className={`text-[11px] font-mono rounded-md px-2 py-0.5 font-medium inline-flex items-center whitespace-nowrap transition-colors duration-150 ${
        isOverdue
          ? 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20'
          : 'bg-subtle text-[var(--text-secondary)] ring-1 ring-inset ring-[var(--border-color)]'
      }`}
    >
      {isOverdue && <AlertTriangle className="w-3 h-3 mr-0.5" />}
      {label}
    </span>
  );
}
