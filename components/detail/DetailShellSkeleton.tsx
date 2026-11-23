import { CARD } from '@/components/ui/tone';

const bar = 'rounded skeleton-shimmer';

/** Crumbs, the icon-and-title header, then a two-column body — a DetailShell page loading. */
export default function DetailShellSkeleton() {
  return (
    <div className="animate-fade-up" aria-busy aria-label="Loading">
      <div className="mb-3 flex items-center gap-2">
        <div className={`h-3.5 w-20 ${bar}`} />
        <div className={`h-3.5 w-28 ${bar}`} />
        <div className={`h-3.5 w-40 ${bar}`} />
      </div>
      <div className="flex items-center gap-3.5 mb-6">
        <div className={`w-11 h-11 ${bar} rounded-xl`} />
        <div className="space-y-1.5">
          <div className={`h-2.5 w-16 ${bar}`} />
          <div className={`h-7 w-72 ${bar} rounded-lg`} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${CARD} px-5 py-4 space-y-2.5`}>
              <div className={`h-4 w-32 ${bar}`} />
              <div className={`h-3.5 w-full ${bar}`} />
              <div className={`h-3.5 w-3/4 ${bar}`} />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className={`${CARD} px-5 py-4`}>
              <div className={`h-4 w-24 ${bar} mb-3`} />
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="flex justify-between py-1.5">
                  <div className={`h-3 w-20 ${bar}`} />
                  <div className={`h-3 w-24 ${bar}`} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
