'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  month: string;        // "YYYY-MM"
  currentMonth: string; // today's "YYYY-MM"
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export default function MonthPicker({ month, currentMonth }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => parseInt(month.split('-')[0]));
  const popoverRef = useRef<HTMLDivElement>(null);

  const isCurrentMonth = month === currentMonth;
  const [currentY, currentM] = currentMonth.split('-').map(Number);
  const selectedM = parseInt(month.split('-')[1]);
  const selectedY = parseInt(month.split('-')[0]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [open]);

  // Sync picker year when month prop changes
  useEffect(() => {
    setPickerYear(parseInt(month.split('-')[0]));
  }, [month]);

  function go(delta: number) {
    const next = shiftMonth(month, delta);
    router.push(`/dashboard/my-dtr?month=${next}`);
  }

  function selectMonth(m: number) {
    const val = `${pickerYear}-${String(m).padStart(2, '0')}`;
    setOpen(false);
    router.push(`/dashboard/my-dtr?month=${val}`);
  }

  function isFuture(y: number, m: number): boolean {
    return y > currentY || (y === currentY && m > currentM);
  }

  return (
    <div className="flex items-center gap-1 relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => go(-1)}
        className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors duration-150 cursor-pointer dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
        aria-label="Previous month"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`text-sm font-semibold min-w-[150px] text-center select-none px-3 py-1.5 rounded-lg transition-colors duration-150 cursor-pointer ${
          open
            ? 'text-gold-700 bg-gold-50 dark:bg-gold-500/10 dark:text-gold-300'
            : 'text-stone-700 hover:text-gold-700 hover:bg-gold-50 dark:text-stone-200 dark:hover:bg-gold-500/10 dark:hover:text-gold-300'
        }`}
      >
        {formatMonth(month)}
      </button>

      <button
        type="button"
        onClick={() => go(1)}
        disabled={isCurrentMonth}
        className={`p-1.5 rounded-lg transition-colors duration-150 cursor-pointer ${
          isCurrentMonth
            ? 'text-stone-200 cursor-not-allowed'
            : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200'
        }`}
        aria-label="Next month"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {!isCurrentMonth && (
        <button
          type="button"
          onClick={() => router.push(`/dashboard/my-dtr?month=${currentMonth}`)}
          className="ml-1 px-2.5 py-1 text-xs font-medium text-gold-700 bg-gold-50 hover:bg-gold-100 rounded-lg transition-colors duration-150 cursor-pointer dark:bg-gold-500/10 dark:hover:bg-gold-500/20 dark:text-gold-300"
        >
          Today
        </button>
      )}

      {/* Custom month picker popover */}
      {open && (
        <div className="absolute right-0 top-full mt-2 bg-white border border-stone-200 rounded-xl shadow-lg p-4 z-30 w-[260px] dark:bg-stone-900 dark:border-stone-700">
          {/* Year navigation */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setPickerYear((y) => y - 1)}
              className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors duration-150 cursor-pointer dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">{pickerYear}</span>
            <button
              type="button"
              onClick={() => setPickerYear((y) => y + 1)}
              disabled={pickerYear >= currentY}
              className={`p-1 rounded-md transition-colors duration-150 cursor-pointer ${
                pickerYear >= currentY
                  ? 'text-stone-200 cursor-not-allowed'
                  : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-1.5">
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
                  className={`px-2 py-2 text-xs font-medium rounded-lg transition-all duration-150 cursor-pointer ${
                    future
                      ? 'text-stone-200 cursor-not-allowed'
                      : isSelected
                        ? 'bg-gold-500 text-white shadow-sm'
                        : isCurrent
                          ? 'bg-gold-50 text-gold-700 hover:bg-gold-100 dark:bg-gold-500/10 dark:hover:bg-gold-500/20 dark:text-gold-300'
                          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
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
