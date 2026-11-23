import { PageHeaderSkeleton } from './Skeletons';

/**
 * Skeleton loader that matches the actual listing page layout:
 * PageHeader → DataTable toolbar → table with column headers and rows.
 */
interface Props {
  /** Number of visible columns to show in the table skeleton */
  columns?: number;
  /** Number of skeleton rows */
  rows?: number;
  /** Summary cards above the toolbar, for lists that have them. */
  cards?: number;
  /** A tab row under the header, for lists that have one. */
  tabs?: boolean;
  /** `count` is for a table with only a count above it, no search or filters. */
  toolbar?: 'filters' | 'count';
}

export default function ListingPageSkeleton({ columns = 4, rows = 8, cards = 0, tabs = false, toolbar = 'filters' }: Props) {
  return (
    <div className="animate-fade-up">
      <PageHeaderSkeleton />

      {tabs && <div className="h-7 w-28 rounded-lg skeleton-shimmer mb-4" />}

      {/* ── Summary cards ──────────────────────────────────── */}
      {cards > 0 && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
          {Array.from({ length: cards }, (_, i) => (
            <div key={i} className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card px-4 py-3.5">
              <div className="flex items-center justify-between">
                <div className="h-3 w-20 rounded skeleton-shimmer" />
                <div className="h-7 w-7 rounded-lg skeleton-shimmer" />
              </div>
              <div className="h-8 w-10 rounded skeleton-shimmer mt-2" />
              <div className="h-3 w-24 rounded skeleton-shimmer mt-1.5" />
            </div>
          ))}
        </div>
      )}

      {/* ── DataTable toolbar skeleton ─────────────────────── */}
      {toolbar === 'count' ? (
        <div className="flex items-center justify-between mb-4">
          <div className="h-4 w-40 rounded skeleton-shimmer" />
          <div className="h-4 w-16 rounded skeleton-shimmer" />
        </div>
      ) : (
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap max-w-full">
            {/* Search input */}
            <div className="h-9 w-52 sm:w-64 max-w-full rounded-xl skeleton-shimmer" />
            {/* Count */}
            <div className="h-4 w-24 rounded skeleton-shimmer" />
          </div>
          <div className="flex items-center gap-2 flex-wrap max-w-full">
            {/* Filter buttons */}
            <div className="h-8 w-20 rounded-lg skeleton-shimmer" />
            <div className="h-8 w-24 rounded-lg skeleton-shimmer" />
            {/* Columns and density */}
            <div className="h-8 w-9 rounded-lg skeleton-shimmer" />
            <div className="h-8 w-16 rounded-lg skeleton-shimmer" />
          </div>
        </div>
      )}

      {/* ── Table skeleton ─────────────────────────────────── */}
      <div className="hidden md:block overflow-hidden rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-stone-100 dark:border-white/[0.06]">
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-4 py-2 text-left">
                  <div className="h-3 w-16 rounded skeleton-shimmer" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-white/[0.06]">
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: columns }).map((_, j) => (
                  <td key={j} className="px-4 py-2.5">
                    <div
                      className={`h-3.5 rounded skeleton-shimmer ${
                        j === 0 ? 'w-48' : j === columns - 1 ? 'w-16' : 'w-24'
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards skeleton ──────────────────────────── */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-card rounded-2xl border border-stone-200 dark:border-white/10 p-4 space-y-2">
            <div className="h-4 w-40 rounded skeleton-shimmer" />
            <div className="flex items-center justify-between">
              <div className="h-3 w-12 rounded skeleton-shimmer" />
              <div className="h-3 w-20 rounded skeleton-shimmer" />
            </div>
            <div className="flex items-center justify-between">
              <div className="h-3 w-12 rounded skeleton-shimmer" />
              <div className="h-5 w-16 rounded-full skeleton-shimmer" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
