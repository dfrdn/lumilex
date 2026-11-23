/**
 * Catalogue order for the scope library.
 *
 * `sort_order` is what decides the order service lines print in a letter, so a
 * line's position is chosen once — when it is first saved — and an edit to its
 * wording never moves it. Letting the column take its database default instead
 * sent the first line anyone edited to the top of every proposal drafted after.
 */

import { DEFAULT_SCOPE_TEMPLATES } from './default';

/**
 * Where a line lands the first time it is saved. A shipped default keeps the
 * position it has in code; anything the firm adds goes after everything else.
 */
export function nextSortOrder(slug: string, rows: { sort_order: number }[]): number {
  const shipped = DEFAULT_SCOPE_TEMPLATES.findIndex((t) => t.slug === slug);
  if (shipped !== -1) return shipped;

  const highest = rows.reduce(
    (max, r) => Math.max(max, r.sort_order),
    DEFAULT_SCOPE_TEMPLATES.length - 1,
  );
  return highest + 1;
}
