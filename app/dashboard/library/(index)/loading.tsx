import { CARD } from '@/components/ui/tone';

/**
 * In the (index) group so only the Library list gets the card grid: a
 * loading.tsx directly in library/ also shows while a child route it has no
 * data for yet is fetched, as when a code or rule link redirects to [id].
 */
export default function Loading() {
  return (
    <div className="animate-fade-up space-y-6" aria-busy aria-label="Loading">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl skeleton-shimmer" />
        <div className="space-y-1.5">
          <div className="h-7 w-32 rounded-lg skeleton-shimmer" />
          <div className="h-3 w-72 max-w-full rounded skeleton-shimmer" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-10 w-80 max-w-full rounded-xl skeleton-shimmer" />
        <div className="h-10 w-64 max-w-full rounded-xl skeleton-shimmer" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${CARD} p-5 space-y-3`}>
            <div className="h-4 w-20 rounded-full skeleton-shimmer" />
            <div className="h-5 w-4/5 rounded skeleton-shimmer" />
            <div className="space-y-1.5">
              <div className="h-3 w-full rounded skeleton-shimmer" />
              <div className="h-3 w-2/3 rounded skeleton-shimmer" />
            </div>
            <div className="h-3 w-28 rounded skeleton-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
