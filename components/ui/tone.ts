import type { Health, ItemState } from '@/lib/corporations/status';

/**
 * The colours companies and marks share. A status, a track's health, an
 * item's state and a deadline's urgency each mean the same thing on either
 * surface, so they read the same way.
 */

/** One palette for track health, used by the cards, the attention list and the registry. */
export const HEALTH_STYLE: Record<Health, { dot: string; bar: string; tint: string; text: string; label: string }> = {
  red: {
    dot: 'bg-rose-500',
    bar: 'bg-rose-500',
    tint: 'from-rose-50/80 dark:from-rose-500/[0.07]',
    text: 'text-rose-700 dark:text-rose-300',
    label: 'Needs attention',
  },
  amber: {
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    tint: 'from-amber-50/80 dark:from-amber-500/[0.07]',
    text: 'text-amber-700 dark:text-amber-300',
    label: 'Due soon',
  },
  green: {
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
    tint: 'from-emerald-50/60 dark:from-emerald-500/[0.05]',
    text: 'text-emerald-700 dark:text-emerald-300',
    label: 'On track',
  },
  grey: {
    dot: 'bg-stone-300 dark:bg-stone-600',
    bar: 'bg-stone-300 dark:bg-stone-600',
    tint: 'from-transparent',
    text: 'text-stone-500 dark:text-stone-400',
    label: 'Not active',
  },
};

export const STATE_CHIP: Record<ItemState, { label: string; cls: string }> = {
  overdue: { label: 'Overdue', cls: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30' },
  waiting_on_client: { label: 'Waiting on client', cls: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30' },
  in_progress: { label: 'In progress', cls: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30' },
  not_started: { label: 'To do', cls: 'bg-stone-50 text-stone-600 ring-stone-200 dark:bg-white/5 dark:text-stone-300 dark:ring-white/10' },
  filed: { label: 'Filed', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30' },
  done: { label: 'Done', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30' },
  not_ours: { label: 'Not ours', cls: 'bg-stone-50 text-stone-400 ring-stone-200 dark:bg-white/5 dark:text-stone-500 dark:ring-white/10' },
};

export type PillTone = 'neutral' | 'amber' | 'blue' | 'rose' | 'emerald' | 'muted' | 'navy' | 'violet' | 'teal' | 'sky' | 'indigo';

/** Lifecycle status pills (a company's "In SEC", a mark's "Pending - OA"). */
export const PILL_TONE: Record<PillTone, string> = {
  neutral: 'bg-stone-50 text-stone-600 border-stone-200 dark:bg-white/5 dark:text-stone-300 dark:border-white/10',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
  blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',
  rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
  muted: 'bg-stone-100 text-stone-400 border-stone-200 dark:bg-white/5 dark:text-stone-500 dark:border-white/10',
  navy: 'bg-navy-50 text-navy-700 border-navy-200 dark:bg-navy-500/15 dark:text-navy-200 dark:border-navy-400/30',
  violet: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20',
  teal: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/20',
  sky: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/25',
};

/** The same tones as a dot and as text, for boards and grouped lists. */
export const TONE_DOT: Record<PillTone, string> = {
  neutral: 'bg-stone-400',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  rose: 'bg-rose-500',
  emerald: 'bg-emerald-500',
  muted: 'bg-stone-300 dark:bg-stone-600',
  navy: 'bg-navy-600 dark:bg-navy-400',
  violet: 'bg-violet-500',
  teal: 'bg-teal-500',
  sky: 'bg-sky-500',
  indigo: 'bg-indigo-500',
};

export const TONE_TEXT: Record<PillTone, string> = {
  neutral: 'text-stone-600 dark:text-stone-300',
  amber: 'text-amber-700 dark:text-amber-300',
  blue: 'text-blue-700 dark:text-blue-300',
  rose: 'text-rose-700 dark:text-rose-300',
  emerald: 'text-emerald-700 dark:text-emerald-300',
  muted: 'text-stone-400 dark:text-stone-500',
  navy: 'text-navy-700 dark:text-navy-200',
  violet: 'text-violet-700 dark:text-violet-300',
  teal: 'text-teal-700 dark:text-teal-300',
  sky: 'text-sky-700 dark:text-sky-300',
  indigo: 'text-indigo-700 dark:text-indigo-300',
};

/**
 * The wash across the top of a header, in the colour of where the thing
 * stands — so a record's state reads before any of its words do.
 */
export const TONE_WASH: Record<PillTone, string> = {
  neutral: 'from-stone-100 via-white to-white dark:from-white/[0.06] dark:via-transparent dark:to-transparent',
  amber: 'from-amber-100/90 via-amber-50/40 to-white dark:from-amber-500/15 dark:via-amber-500/[0.04] dark:to-transparent',
  blue: 'from-blue-100/90 via-blue-50/40 to-white dark:from-blue-500/15 dark:via-blue-500/[0.04] dark:to-transparent',
  rose: 'from-rose-100/90 via-rose-50/40 to-white dark:from-rose-500/15 dark:via-rose-500/[0.04] dark:to-transparent',
  emerald: 'from-emerald-100/90 via-emerald-50/40 to-white dark:from-emerald-500/15 dark:via-emerald-500/[0.04] dark:to-transparent',
  muted: 'from-stone-100 via-white to-white dark:from-white/[0.05] dark:via-transparent dark:to-transparent',
  navy: 'from-navy-100 via-navy-50/40 to-white dark:from-navy-500/20 dark:via-navy-500/[0.05] dark:to-transparent',
  violet: 'from-violet-100/90 via-violet-50/40 to-white dark:from-violet-500/15 dark:via-violet-500/[0.04] dark:to-transparent',
  teal: 'from-teal-100/90 via-teal-50/40 to-white dark:from-teal-500/15 dark:via-teal-500/[0.04] dark:to-transparent',
  sky: 'from-sky-100/90 via-sky-50/40 to-white dark:from-sky-500/15 dark:via-sky-500/[0.04] dark:to-transparent',
  indigo: 'from-indigo-100/90 via-indigo-50/40 to-white dark:from-indigo-500/15 dark:via-indigo-500/[0.04] dark:to-transparent',
};

export type Urgency = 'overdue' | 'soon' | 'month' | 'later';

export const URGENCY_CHIP: Record<Urgency, string> = {
  overdue: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20',
  soon: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
  month: 'bg-amber-50/60 text-amber-700 border-amber-100 dark:bg-amber-500/5 dark:text-amber-300/80 dark:border-amber-500/10',
  later: 'bg-stone-50 text-stone-500 border-stone-200 dark:bg-white/5 dark:text-stone-400 dark:border-white/10',
};

/** A button's shape without its size, corners or colour; `Button` adds both. Focus shows a ring in the button's own colour. */
export const BTN_SHAPE =
  'press inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[var(--card-bg)]';

export type ButtonVariant = 'primary' | 'outline' | 'subtle' | 'success' | 'danger' | 'ghost' | 'ghostDanger';

export const BTN_TONE: Record<ButtonVariant, string> = {
  primary:
    'bg-navy-800 text-white hover:bg-navy-700 dark:bg-navy-600 dark:hover:bg-navy-500 shadow-sm focus-visible:ring-navy-400',
  outline:
    'border border-stone-300 dark:border-white/15 bg-white dark:bg-transparent text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5 focus-visible:ring-stone-300 dark:focus-visible:ring-white/30',
  subtle:
    'border border-[var(--border-color)] bg-subtle text-[var(--text-secondary)] hover:bg-card-hover focus-visible:ring-stone-300 dark:focus-visible:ring-white/30',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm focus-visible:ring-emerald-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm focus-visible:ring-red-500',
  ghost:
    'text-stone-500 hover:text-stone-800 hover:bg-stone-100 dark:text-stone-400 dark:hover:text-stone-100 dark:hover:bg-white/5 focus-visible:ring-stone-300 dark:focus-visible:ring-white/30',
  ghostDanger:
    'text-stone-500 hover:text-rose-600 hover:bg-rose-50 dark:text-stone-400 dark:hover:text-rose-400 dark:hover:bg-rose-500/10 focus-visible:ring-rose-400',
};

export const BTN_PRIMARY = `${BTN_SHAPE} text-xs rounded-lg ${BTN_TONE.primary}`;
export const BTN_OUTLINE = `${BTN_SHAPE} text-xs rounded-lg ${BTN_TONE.outline}`;
export const BTN_GHOST_DANGER =
  'inline-flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg text-stone-500 hover:text-rose-600 hover:bg-rose-50 dark:text-stone-400 dark:hover:text-rose-400 dark:hover:bg-rose-500/10 transition-colors';

/** The card every subject page section sits in. */
export const CARD = 'rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card';

/** The tinted icon tile on a summary card and beside a section's title. */
export const ACCENT_TILE = {
  emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10',
  sky: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10',
  indigo: 'text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15',
  rose: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10',
  amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10',
  gold: 'text-gold-600 dark:text-gold-400 bg-gold-50 dark:bg-gold-500/10',
  navy: 'text-navy-700 dark:text-navy-300 bg-navy-50 dark:bg-navy-500/15',
  violet: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/10',
  stone: 'text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-white/10',
} as const;

export type Accent = keyof typeof ACCENT_TILE;
