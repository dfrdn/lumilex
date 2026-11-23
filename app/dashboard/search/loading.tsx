import { PageHeaderSkeleton } from '@/components/ui/Skeletons';

export default function Loading() {
  return (
    <div className="animate-fade-up" aria-busy aria-label="Loading">
      <PageHeaderSkeleton />
      <div className="space-y-5">
        <div className="h-10 w-72 max-w-full rounded-xl skeleton-shimmer" />
        <div className="h-[54px] rounded-xl skeleton-shimmer" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-7 w-16 rounded-lg skeleton-shimmer" />
          <div className="h-7 w-28 rounded-lg skeleton-shimmer" />
          <div className="h-7 w-24 rounded-lg skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}
