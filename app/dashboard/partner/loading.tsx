export default function PartnerLoading() {
  return (
    <div>
      {/* Page heading + period selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
        <div>
          <div className="h-7 w-52 rounded skeleton-shimmer mb-2" />
          <div className="h-4 w-40 rounded skeleton-shimmer" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-40 rounded-lg skeleton-shimmer" />
          <div className="h-8 w-28 rounded-lg skeleton-shimmer" />
        </div>
      </div>

      {/* 5 summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-8">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-[#1C1C1E] rounded-xl ring-1 ring-stone-900/5 dark:ring-white/5 p-4 sm:p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg skeleton-shimmer" />
              <div className="h-3 w-20 rounded skeleton-shimmer" />
            </div>
            <div className="h-8 w-16 rounded skeleton-shimmer" />
          </div>
        ))}
      </div>

      {/* DTR section */}
      <div className="mb-8">
        <div className="h-3 w-24 rounded skeleton-shimmer mb-3" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-[#1C1C1E] rounded-xl ring-1 ring-stone-900/5 dark:ring-white/5 p-4 sm:p-5">
              <div className="h-4 w-32 rounded skeleton-shimmer mb-4" />
              <div className="h-64 sm:h-72 rounded-lg skeleton-shimmer" />
            </div>
          ))}
        </div>
      </div>

      {/* Deliverables section */}
      <div className="mb-8">
        <div className="h-3 w-24 rounded skeleton-shimmer mb-3" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-[#1C1C1E] rounded-xl ring-1 ring-stone-900/5 dark:ring-white/5 p-4 sm:p-5">
              <div className="h-4 w-32 rounded skeleton-shimmer mb-4" />
              <div className="h-64 sm:h-72 rounded-lg skeleton-shimmer" />
            </div>
          ))}
        </div>
      </div>

      {/* Hearings & Filings */}
      <div className="mb-8">
        <div className="h-3 w-32 rounded skeleton-shimmer mb-3" />
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl ring-1 ring-stone-900/5 dark:ring-white/5 p-4 sm:p-5">
          <div className="h-4 w-40 rounded skeleton-shimmer mb-4" />
          <div className="h-64 sm:h-72 rounded-lg skeleton-shimmer" />
        </div>
      </div>

      {/* Matter Assignments */}
      <div className="mb-8">
        <div className="h-3 w-32 rounded skeleton-shimmer mb-3" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-[#1C1C1E] rounded-xl ring-1 ring-stone-900/5 dark:ring-white/5 p-4 sm:p-5">
              <div className="h-4 w-32 rounded skeleton-shimmer mb-4" />
              <div className="h-64 sm:h-72 rounded-lg skeleton-shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
