import type { ReactNode } from 'react';

/**
 * Card wrapper shared across pane components — matches the SectionCard visual
 * language used throughout the dashboard (rounded-xl border + shadow + header
 * with icon/title + optional count).
 */
export default function PaneCard({
  title,
  icon,
  count,
  children,
  className = '',
}: {
  title: string;
  icon?: ReactNode;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up ${className}`}
    >
      <header className="px-5 py-3 border-b border-[var(--border-color)] flex items-center gap-2">
        {icon && <span className="text-[var(--text-muted)]">{icon}</span>}
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {title}
        </h3>
        {typeof count === 'number' && count > 0 && (
          <span className="ml-auto text-[10px] font-mono font-semibold bg-gold-50 text-gold-700 dark:bg-gold-400/15 dark:text-gold-400 rounded-full px-1.5 py-0.5 tabular-nums">
            {count}
          </span>
        )}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
