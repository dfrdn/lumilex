'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { Health } from '@/lib/corporations/status';
import { daysBetween, manilaToday, spanOfDays } from '@/lib/dates';
import { formatDateShort } from '@/lib/format-date';
import { ACCENT_TILE, CARD, HEALTH_STYLE, PILL_TONE, TONE_DOT, URGENCY_CHIP, type Accent, type PillTone, type Urgency } from './tone';

/**
 * The pieces a company's page and a mark's page are both built from, so the
 * two read as one product. Colours live in ./tone.
 */

const STOP_WORDS = /^(inc|corp|corporation|co|opc|the|of|and)$/i;

/** Two initials for a name, skipping "Inc", "Corp", "of" and the like. */
export function monogram(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP_WORDS.test(w));
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '·';
}

/**
 * A subject's thumbnail in a list row: its image when it has one (a mark's
 * logo), else navy-and-gold initials, with a dot when its health needs a look.
 * Grows with the list's Comfortable density.
 */
export function RowThumb({ name, imageUrl, health }: { name: string; imageUrl?: string | null; health?: Health | null }) {
  const size =
    'w-8 h-8 rounded-lg group-data-[density=comfortable]/rows:w-10 group-data-[density=comfortable]/rows:h-10 group-data-[density=comfortable]/rows:rounded-xl';
  return (
    <span className="relative shrink-0">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          className={`${size} block bg-white border border-stone-200 dark:border-white/10 object-contain transition-transform group-hover:scale-105`}
        />
      ) : (
        <span
          className={`${size} bg-gradient-to-br from-navy-800 to-navy-950 text-gold-300 font-serif text-[11px] group-data-[density=comfortable]/rows:text-[13px] flex items-center justify-center ring-1 ring-gold-400/20 transition-transform group-hover:scale-105`}
        >
          {monogram(name)}
        </span>
      )}
      {health && health !== 'grey' && health !== 'green' && (
        <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-[var(--card-bg)] ${HEALTH_STYLE[health].dot}`} />
      )}
    </span>
  );
}

/** A small grey tag in a header — company type, "SEC …", a mark's country. */
export function MetaChip({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md bg-stone-100/80 text-stone-600 dark:bg-white/[0.06] dark:text-stone-300 text-[11px] ${mono ? 'font-mono tracking-tight' : ''}`}
    >
      {children}
    </span>
  );
}

/** A lifecycle status as a pill. Pass `onClick` to make it the way the status changes. */
export function StatusPill({
  label,
  tone,
  hint,
  onClick,
  trailing,
  disabled,
  buttonRef,
  size = 'md',
}: {
  label: string;
  tone: PillTone;
  hint?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  disabled?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[11px]';
  const cls = `inline-flex items-center gap-1 ${pad} font-medium rounded-full border whitespace-nowrap ${PILL_TONE[tone]}`;
  const dot = <span className={`${size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5'} rounded-full shrink-0 ${TONE_DOT[tone]}`} aria-hidden="true" />;
  if (!onClick) {
    return (
      <span title={hint} className={cls}>
        {dot}
        {label}
      </span>
    );
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      title={hint}
      onClick={onClick}
      disabled={disabled}
      className={`${cls} press cursor-pointer hover:brightness-95 dark:hover:brightness-125 transition disabled:opacity-60`}
    >
      {dot}
      {label}
      {trailing}
    </button>
  );
}

/** A section title's icon on its tinted tile. */
export function IconChip({ accent = 'navy', children }: { accent?: Accent; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5 ${ACCENT_TILE[accent]}`}>
      {children}
    </span>
  );
}

/** A section of a subject page: an icon-led title, an optional action on the right, then the body. */
export function SubjectCard({
  title,
  icon,
  accent,
  action,
  children,
  className = '',
  bodyClassName = 'px-5 pb-4',
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** The tint of the icon's tile — what kind of section this is. */
  accent?: Accent;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`${CARD} ${className}`}>
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold text-stone-800 dark:text-stone-100">
          {icon && <IconChip accent={accent}>{icon}</IconChip>}
          {title}
        </h3>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** One label–value line of an "At a glance" list. */
export function Fact({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-stone-100 dark:border-white/[0.06] last:border-0">
      <dt className="text-[12px] text-stone-500 dark:text-stone-400 shrink-0">{label}</dt>
      <dd className={`min-w-0 text-[13px] text-right text-stone-800 dark:text-stone-100 ${mono ? 'font-mono text-[12px]' : ''}`}>
        {value ?? <span className="text-stone-400 dark:text-stone-500">—</span>}
      </dd>
    </div>
  );
}

/** A value people paste elsewhere (a reference or registration number): click to copy it. */
export function CopyText({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => toast.error('Couldn’t copy — select the text instead.'),
        );
      }}
      className={`group inline-flex items-center gap-1.5 font-mono cursor-pointer break-all text-left rounded px-1 -mx-1 hover:bg-stone-100 dark:hover:bg-white/5 transition-colors ${className}`}
      title={copied ? 'Copied' : 'Copy'}
      aria-label={`Copy ${text}`}
    >
      {text}
      {copied ? (
        <Check className="pop w-3 h-3 text-emerald-500 shrink-0" />
      ) : (
        <Copy className="w-3 h-3 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      )}
    </button>
  );
}

export function urgencyFor(due: string, today = manilaToday()): { days: number; urgency: Urgency } {
  const days = daysBetween(today, due);
  const urgency: Urgency = days < 0 ? 'overdue' : days <= 7 ? 'soon' : days <= 30 ? 'month' : 'later';
  return { days, urgency };
}

/** "in 12 days", "today", "3 months overdue", "in 4 years". */
export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  return days < 0 ? `${spanOfDays(days)} overdue` : `in ${spanOfDays(days)}`;
}

/** A due date with how far away it is, coloured by urgency. */
export function DueChip({ due, showDate = true }: { due: string; showDate?: boolean }) {
  const { days, urgency } = urgencyFor(due);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {showDate && <span className="text-xs text-stone-800 dark:text-stone-100">{formatDateShort(due)}</span>}
      <span className={`inline-flex items-center px-1.5 py-px text-[10px] font-medium rounded-full border ${URGENCY_CHIP[urgency]}`}>
        {relativeDays(days)}
      </span>
    </span>
  );
}
