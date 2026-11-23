'use client';

import { useEffect, useState } from 'react';
import { Rows2, Rows3 } from 'lucide-react';

export type Density = 'compact' | 'comfortable';

/** A list's row density, remembered per list in this browser. */
export function useRowDensity(storageKey: string): [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>('compact');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the saved choice after mount keeps SSR and hydration identical
      if (saved === 'comfortable' || saved === 'compact') setDensity(saved);
    } catch {
      /* storage blocked: stay compact */
    }
  }, [storageKey]);

  function choose(d: Density) {
    setDensity(d);
    try {
      window.localStorage.setItem(storageKey, d);
    } catch {
      /* not remembered, still applied */
    }
  }

  return [density, choose];
}

/** The Compact / Comfortable switch. */
export function DensityToggle({
  density,
  onChange,
  iconOnly = false,
}: {
  density: Density;
  onChange: (d: Density) => void;
  /** Drop the words where the toolbar is already full. */
  iconOnly?: boolean;
}) {
  const option = (d: Density, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onChange(d)}
      aria-pressed={density === d}
      title={`${label} rows`}
      className={`press inline-flex items-center gap-1 ${iconOnly ? 'p-1.5' : 'px-2 py-1'} rounded-md transition-all ${
        density === d
          ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium'
          : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'
      }`}
    >
      {icon}
      {!iconOnly && <span className="hidden sm:inline">{label}</span>}
    </button>
  );

  return (
    <div className="inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-[11.5px]" role="group" aria-label="Row density">
      {option('compact', 'Compact', <Rows3 className="w-3.5 h-3.5" />)}
      {option('comfortable', 'Comfortable', <Rows2 className="w-3.5 h-3.5" />)}
    </div>
  );
}

/**
 * Wraps server-rendered rows with the density switch. Density only switches
 * CSS — each row styles itself with `group-data-[density=comfortable]/rows:`
 * variants — so changing it is instant and fetches nothing.
 */
export default function RowDensity({ storageKey, children }: { storageKey: string; children: React.ReactNode }) {
  const [density, setDensity] = useRowDensity(storageKey);
  return (
    <div data-density={density} className="group/rows space-y-2">
      <div className="flex justify-end">
        <DensityToggle density={density} onChange={setDensity} />
      </div>
      {children}
    </div>
  );
}
