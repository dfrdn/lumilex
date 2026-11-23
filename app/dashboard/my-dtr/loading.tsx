export default function Loading() {
  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div className="h-8 skeleton-shimmer rounded-lg w-40" />
        <div className="h-9 skeleton-shimmer rounded-lg w-52" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[100px] skeleton-shimmer rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-72 skeleton-shimmer rounded-xl" />
        <div className="h-72 skeleton-shimmer rounded-xl" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 skeleton-shimmer rounded-lg" />
        ))}
      </div>
    </div>
  );
}
