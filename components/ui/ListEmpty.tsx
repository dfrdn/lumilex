import Link from 'next/link';
import { Plus } from 'lucide-react';
import { BTN_OUTLINE, BTN_PRIMARY } from './tone';

/**
 * An empty list that says why and offers the way out: clear the filters that
 * hid everything, or add the first one.
 */
export default function ListEmpty({
  icon,
  filtered,
  matchNone,
  none,
  clearHref,
  newHref,
  newLabel,
}: {
  icon: React.ReactNode;
  filtered: boolean;
  /** "No companies match." */
  matchNone: string;
  /** "No companies yet." */
  none: string;
  clearHref: string;
  newHref: string;
  newLabel: string;
}) {
  return (
    <div className="reveal rounded-2xl border border-dashed border-stone-200 dark:border-white/10 px-6 py-12 text-center">
      <span className="text-stone-300 dark:text-stone-600 inline-flex">{icon}</span>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{filtered ? matchNone : none}</p>
      <div className="mt-4 flex justify-center gap-2">
        {filtered && (
          <Link href={clearHref} className={`${BTN_OUTLINE} px-3 py-1.5`}>
            Clear filters
          </Link>
        )}
        <Link href={newHref} className={`${filtered ? BTN_OUTLINE : BTN_PRIMARY} px-3 py-1.5`}>
          <Plus className="w-3.5 h-3.5" /> {newLabel}
        </Link>
      </div>
    </div>
  );
}
