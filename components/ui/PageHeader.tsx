interface Props {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Optional right-aligned action (e.g. a link/button). */
  action?: React.ReactNode;
}

export default function PageHeader({ icon, title, subtitle, action }: Props) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-serif text-[2.25rem] leading-[1.05] text-stone-900 dark:text-stone-50 flex items-center gap-2.5">
          <span className="text-stone-400 dark:text-stone-500 shrink-0">{icon}</span>
          {title}
        </h1>
        {subtitle && <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
