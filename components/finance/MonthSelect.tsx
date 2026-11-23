'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Calendar } from 'lucide-react';
import { manilaYear, manilaMonthIndex } from '@/lib/dates';

interface Props {
  value: string;         // "YYYY-MM"
  onChange: (value: string) => void;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export default function MonthSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => parseInt(value.split('-')[0]));
  const containerRef = useRef<HTMLDivElement>(null);

  const currentY = manilaYear();
  const currentM = manilaMonthIndex() + 1;
  const selectedY = parseInt(value.split('-')[0]);
  const selectedM = parseInt(value.split('-')[1]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [open]);

  // Sync picker year when value changes
  useEffect(() => {
    setPickerYear(parseInt(value.split('-')[0]));
  }, [value]);

  function selectMonth(m: number) {
    const val = `${pickerYear}-${String(m).padStart(2, '0')}`;
    onChange(val);
    setOpen(false);
  }

  function isFuture(y: number, m: number): boolean {
    return y > currentY || (y === currentY && m > currentM);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-xl bg-[var(--background)] border border-[var(--border-color)] text-foreground hover:border-gold-400/50 focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          {formatMonth(value)}
        </span>
        <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] z-50 p-3">
          {/* Year navigation */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setPickerYear((y) => y - 1)}
              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-foreground">{pickerYear}</span>
            <button
              type="button"
              onClick={() => setPickerYear((y) => y + 1)}
              disabled={pickerYear >= currentY}
              className={`p-1 rounded-lg transition-colors cursor-pointer ${
                pickerYear >= currentY
                  ? 'text-[var(--text-muted)] opacity-30 cursor-not-allowed'
                  : 'text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-1">
            {MONTH_LABELS.map((label, i) => {
              const m = i + 1;
              const future = isFuture(pickerYear, m);
              const isSelected = pickerYear === selectedY && m === selectedM;
              const isCurrent = pickerYear === currentY && m === currentM;

              return (
                <button
                  key={label}
                  type="button"
                  disabled={future}
                  onClick={() => selectMonth(m)}
                  className={`px-2 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                    future
                      ? 'text-[var(--text-muted)] opacity-30 cursor-not-allowed'
                      : isSelected
                        ? 'bg-gold-500 text-white shadow-sm'
                        : isCurrent
                          ? 'bg-gold-500/10 text-gold-600 dark:text-gold-400 hover:bg-gold-500/20'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
