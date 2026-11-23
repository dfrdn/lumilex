/** A titled group in a list of what falls due — "Overdue", "March 2027". */
export default function ListSection({
  title,
  count,
  tone,
  icon,
  children,
}: {
  title: string;
  count?: string;
  /** Header tint; overdue groups use rose. */
  tone?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card overflow-hidden">
      <div className={`flex items-baseline justify-between px-5 py-3 border-b border-stone-100 dark:border-white/[0.06] ${tone ?? ''}`}>
        <h3 className="inline-flex items-center gap-2 font-serif text-base text-stone-900 dark:text-stone-50">
          {icon}
          {title}
        </h3>
        {count && <span className="text-[11px] text-stone-500 dark:text-stone-400">{count}</span>}
      </div>
      {children}
    </section>
  );
}
