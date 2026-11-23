// The look every page that edits firm wording shares — the billing letter, the
// trademark reports — styled as the applicant letters editor
// (app/dashboard/careers/ApplicantLettersEditor.tsx).
export const CARD = 'rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card p-5';
export const LABEL = 'block text-xs font-medium text-[var(--text-secondary)] mb-1';
export const BTN =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors cursor-pointer';
export const SAVE =
  'inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white rounded-lg bg-navy-800 hover:bg-navy-700 dark:bg-navy-600 dark:hover:bg-navy-500 disabled:opacity-50 cursor-pointer transition-colors';
export const INPUT =
  'w-full rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold-400 disabled:opacity-60';

/** A row in the left-hand list of what can be edited. */
export const navItem = (active: boolean) =>
  `flex-1 min-w-0 text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${active ? 'bg-stone-100 dark:bg-white/10 text-foreground font-medium' : 'text-[var(--text-secondary)] hover:bg-stone-50 dark:hover:bg-white/5'}`;

/** The Letter / Email switch above the editor. */
export const modeButton = (active: boolean) =>
  `px-4 py-1.5 transition-colors cursor-pointer ${active ? 'bg-navy-100 text-navy-800 dark:bg-gold-400/15 dark:text-gold-300 font-medium' : 'text-[var(--text-secondary)] hover:bg-stone-50 dark:hover:bg-white/5'}`;
