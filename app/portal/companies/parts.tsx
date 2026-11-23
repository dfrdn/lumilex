import type { Health } from '@/lib/corporations/status';

function monogram(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !/^(inc|corp|corporation|co|opc|the|of|and)$/i.test(w));
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '·';
}

export function CompanyMonogram({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'w-14 h-14 text-xl rounded-2xl' : 'w-11 h-11 text-base rounded-xl';
  return (
    <span
      className={`${dims} shrink-0 inline-flex items-center justify-center font-serif tracking-wide bg-gradient-to-br from-navy-800 to-navy-950 text-gold-300 ring-1 ring-gold-400/30 shadow-sm`}
    >
      {monogram(name)}
    </span>
  );
}

const FILL: Record<Health, string> = {
  green: 'bg-emerald-500 dark:bg-emerald-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  red: 'bg-red-500 dark:bg-red-400',
  grey: 'bg-navy-400 dark:bg-gold-400/70',
};

/** A labelled progress bar that draws itself in. `index` staggers it with its neighbours. */
export function TrackBar({
  label,
  done,
  total,
  health,
  index = 0,
  compact = false,
}: {
  label: string;
  done: number;
  total: number;
  health: Health;
  index?: number;
  compact?: boolean;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className={`flex items-baseline justify-between gap-2 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <span className="text-[var(--text-secondary)] truncate">{label}</span>
        <span className="tabular-nums text-[var(--text-muted)] shrink-0">
          {done} of {total}
        </span>
      </div>
      <div className={`mt-1 ${compact ? 'h-1' : 'h-1.5'} rounded-full bg-subtle overflow-hidden`}>
        <div
          className={`grow-x h-full rounded-full ${FILL[health]}`}
          style={{ width: `${pct}%`, '--i': index } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
