import type { LucideIcon } from 'lucide-react';

/** Gold small-caps line above a title. */
export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-medium uppercase tracking-[0.2em] text-gold-700 dark:text-gold-400 ${className}`}>
      {children}
    </p>
  );
}

/** Eyebrow + serif title + one-line lede; the top of every portal page. */
export function PageIntro({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  /** Right-aligned content on wide screens (a primary action, a total). */
  aside?: React.ReactNode;
}) {
  return (
    <section className="mb-8 pb-8 border-b border-gold-200/40 dark:border-gold-400/15 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="font-serif text-3xl md:text-4xl text-foreground tracking-tight mt-2 text-balance">{title}</h1>
        {lede && <p className="text-sm sm:text-[15px] text-[var(--text-secondary)] mt-2 max-w-2xl leading-relaxed">{lede}</p>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </section>
  );
}

/** Muted uppercase label that heads a block of content, optionally with an icon. */
export function SectionTitle({
  icon: Icon,
  children,
  trailing,
  className = '',
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {children}
      </h2>
      {trailing && <div className="text-[11px] text-[var(--text-muted)]">{trailing}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'navy' | 'gold' | 'green' | 'red' | 'amber';

const CARD_TONE: Record<Tone, string> = {
  neutral: 'border-[var(--border-color)] bg-card',
  navy: 'border-navy-200/60 dark:border-navy-400/20 bg-navy-50/40 dark:bg-navy-500/5',
  gold: 'border-gold-300/60 dark:border-gold-400/30 bg-gold-50/50 dark:bg-gold-400/5',
  green: 'border-emerald-200/60 dark:border-emerald-400/20 bg-emerald-50/40 dark:bg-emerald-400/5',
  red: 'border-red-200/60 dark:border-red-400/20 bg-red-50/40 dark:bg-red-400/5',
  amber: 'border-amber-200/60 dark:border-amber-400/20 bg-amber-50/40 dark:bg-amber-400/5',
};

/** Bordered surface. `tone="gold"` marks something that wants the client's attention. */
export function Card({
  children,
  tone = 'neutral',
  padding = 'md',
  className = '',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  tone?: Tone;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  const pad = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6 sm:p-8' }[padding];
  return <Tag className={`border rounded-2xl ${CARD_TONE[tone]} ${pad} ${className}`}>{children}</Tag>;
}

const CHIP_TONE: Record<Tone, string> = {
  neutral: 'text-[var(--text-secondary)] bg-subtle',
  navy: 'text-navy-700 dark:text-gold-400 bg-navy-50 dark:bg-gold-400/10',
  gold: 'text-white dark:text-navy-950 bg-gold-500 dark:bg-gold-400',
  green: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-400/10',
  red: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-400/10',
  amber: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-400/10',
};

/** Tiny uppercase status label. `mono` for reference codes. */
export function Chip({
  children,
  tone = 'neutral',
  mono = false,
  className = '',
}: {
  children: React.ReactNode;
  tone?: Tone;
  mono?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${mono ? 'font-mono' : ''} ${CHIP_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Centered "nothing here" message with the one thing the reader can do next. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  compact = false,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`border border-dashed border-[var(--border-hover)] rounded-2xl text-center ${compact ? 'px-5 py-8' : 'px-6 py-12'}`}>
      {Icon && <Icon className="w-6 h-6 mx-auto text-[var(--text-muted)] mb-3" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body && <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-sm mx-auto leading-relaxed">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** A row of mutually exclusive choices — status filters, sort orders. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; count?: number }[];
  label?: string;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {label && (
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mr-1">{label}</span>
      )}
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={`${pad} rounded-full font-medium border transition-colors whitespace-nowrap ${
              active
                ? 'bg-navy-800 text-white border-navy-800 dark:bg-gold-400 dark:text-navy-950 dark:border-gold-400'
                : 'bg-card text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--border-hover)] hover:text-foreground'
            }`}
          >
            {o.label}
            {o.count != null && <span className={`ml-1 ${active ? 'opacity-70' : 'opacity-60'}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Text input styling shared by search boxes and form fields. */
export const INPUT_CLASS =
  'w-full text-sm rounded-xl border border-[var(--border-color)] bg-card text-foreground placeholder:text-[var(--text-muted)] hover:border-[var(--border-hover)] focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 transition-all disabled:opacity-50';

/** Notice line — a short sentence with an icon, for consent, privacy, and error copy. */
export function Notice({
  icon: Icon,
  tone = 'neutral',
  children,
  role,
}: {
  icon?: LucideIcon;
  tone?: 'neutral' | 'red' | 'green' | 'gold';
  children: React.ReactNode;
  role?: 'alert' | 'status';
}) {
  const tones = {
    neutral: 'text-[var(--text-secondary)] bg-subtle border-[var(--border-color)]',
    red: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/20',
    green: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20',
    gold: 'text-gold-800 dark:text-gold-300 bg-gold-50 dark:bg-gold-400/10 border-gold-200 dark:border-gold-400/20',
  }[tone];
  return (
    <div role={role} className={`flex items-start gap-2 text-sm rounded-xl border px-3.5 py-2.5 leading-relaxed ${tones}`}>
      {Icon && <Icon className="w-4 h-4 shrink-0 mt-0.5" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
