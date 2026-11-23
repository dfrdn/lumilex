'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  year: number;
  currentYear: number;
}

export default function PeriodSelector({ year, currentYear }: Props) {
  const router = useRouter();

  function nav(newYear: number) {
    router.push(`/dashboard/partner?year=${newYear}`);
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => nav(year - 1)}
        className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors duration-150 cursor-pointer dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
        aria-label="Previous year"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm font-semibold text-stone-700 min-w-[48px] text-center tabular-nums dark:text-stone-200">
        {year}
      </span>
      <button
        type="button"
        onClick={() => nav(year + 1)}
        disabled={year >= currentYear}
        className={`p-1.5 rounded-lg transition-colors duration-150 cursor-pointer ${
          year >= currentYear
            ? 'text-stone-200 cursor-not-allowed'
            : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200'
        }`}
        aria-label="Next year"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {year !== currentYear && (
        <button
          type="button"
          onClick={() => nav(currentYear)}
          className="ml-1 px-2.5 py-1 text-xs font-medium text-gold-700 bg-gold-50 hover:bg-gold-100 rounded-lg transition-colors duration-150 cursor-pointer dark:bg-gold-500/10 dark:hover:bg-gold-500/20 dark:text-gold-300"
        >
          This Year
        </button>
      )}
    </div>
  );
}
