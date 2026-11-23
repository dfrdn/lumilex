'use client';

import { useRef, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import CellDropdown from '@/components/admin/CellDropdown';

interface Props {
  /** Available "YYYY-MM" values to choose from (any order — sorted newest-first here). */
  months: string[];
  /** Selected month, or null for "All months". */
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}

export function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Compact month filter built on the shared CellDropdown. `null` = all months. */
export default function MonthFilter({ months, value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const sorted = [...new Set(months)].sort((a, b) => b.localeCompare(a));
  const options = [
    { id: 'all', label: 'All months' },
    ...sorted.map((m) => ({ id: m, label: monthLabel(m) })),
  ];

  return (
    <div ref={anchorRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 h-9 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-sm text-foreground hover:border-gold-300 dark:hover:border-gold-500/40 transition-colors cursor-pointer"
      >
        <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span className={value ? 'font-medium' : 'text-[var(--text-secondary)]'}>
          {value ? monthLabel(value) : 'All months'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          options={options}
          value={value ?? 'all'}
          anchorRef={anchorRef}
          placeholder="Filter by month…"
          onSelect={(id) => onChange(id && id !== 'all' ? id : null)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
