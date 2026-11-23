import SectionCard from '@/components/ui/SectionCard';

/** Holds a streamed widget's place while it loads. */
export default function WidgetSkeleton({ id, title, icon, rows = 3 }: { id?: string; title: string; icon: React.ReactNode; rows?: number }) {
  return (
    <SectionCard id={id} title={title} icon={icon}>
      <div className="space-y-2 px-1 pb-2" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-9 rounded-lg skeleton-shimmer" />
        ))}
      </div>
    </SectionCard>
  );
}
