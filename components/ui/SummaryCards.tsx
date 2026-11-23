import Link from 'next/link';
import { ACCENT_TILE } from './tone';

export interface SummaryCard {
  key: string;
  label: string;
  /** A count, or a placeholder such as '—' when it couldn't be read. */
  value: number | string;
  sub: string;
  icon: React.ReactNode;
  accent: keyof typeof ACCENT_TILE;
  active?: boolean;
  /** A list filter in the URL, or… */
  href?: string;
  /** …a filter held in the page's state. */
  onClick?: () => void;
}

/** The book at a glance: one number per card, each card the filter behind its number. */
export default function SummaryCards({ cards, className = 'grid-cols-2 lg:grid-cols-4' }: { cards: SummaryCard[]; className?: string }) {
  return (
    <div className={`grid gap-3 ${className}`}>
      {cards.map((c, i) => {
        const cls = `rise-in press group text-left rounded-2xl border bg-white dark:bg-card px-4 py-3.5 transition-all hover:-translate-y-px hover:shadow-[0_6px_20px_-12px_rgba(0,0,0,0.25)] ${
          c.active ? 'border-navy-300 ring-1 ring-navy-200 dark:border-navy-400/40 dark:ring-navy-400/20' : 'border-stone-200 dark:border-white/10'
        }`;
        const body = (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-stone-500 dark:text-stone-400 truncate">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${ACCENT_TILE[c.accent]}`}>{c.icon}</span>
            </div>
            <div className="mt-1.5 font-serif text-3xl tabular-nums text-stone-900 dark:text-stone-50">{c.value}</div>
            <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{c.sub}</div>
          </>
        );
        const style = { '--i': i } as React.CSSProperties;
        return c.href ? (
          <Link key={c.key} href={c.href} style={style} className={cls} aria-current={c.active ? 'true' : undefined}>
            {body}
          </Link>
        ) : (
          <button key={c.key} type="button" onClick={c.onClick} style={style} className={cls} aria-pressed={!!c.active}>
            {body}
          </button>
        );
      })}
    </div>
  );
}
