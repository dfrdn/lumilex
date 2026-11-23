/**
 * A dated item's thumbnail in a page header — a hearing's or a meeting's day
 * as a calendar leaf, in the monogram's place. Tinted when it's today, or
 * past with nothing recorded.
 */
export default function DateBadge({ day, tone = 'default' }: { day: string | null; tone?: 'default' | 'today' | 'late' }) {
  const d = day ? new Date(`${day}T00:00:00Z`) : null;
  const ring =
    tone === 'today'
      ? 'ring-amber-300 dark:ring-amber-500/40'
      : tone === 'late'
        ? 'ring-rose-300 dark:ring-rose-500/40'
        : 'ring-gold-400/30';
  return (
    <div className={`w-12 h-12 rounded-xl overflow-hidden shadow-sm ring-1 ${ring} shrink-0 flex flex-col text-center`}>
      <span className="bg-gradient-to-br from-navy-800 to-navy-950 text-gold-300 text-[9px] font-semibold uppercase tracking-wider leading-4">
        {d ? d.toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' }) : '—'}
      </span>
      <span className="flex-1 flex items-center justify-center bg-white dark:bg-card font-serif text-xl leading-none text-stone-900 dark:text-stone-50">
        {d ? d.getUTCDate() : '?'}
      </span>
    </div>
  );
}
