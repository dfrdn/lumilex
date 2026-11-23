/**
 * Groups a lawyer's billing entries by the matter they were rendered on, so the
 * breakdown reads "lawyer → matter → entries" the way the firm's own billing
 * statements do:
 *
 *   Maria Reyes (MCR)
 *     [10-01-01] People v. Dela Cruz
 *       05-Mar   1.8   Review and Revise — Special Power of Attorney …
 *     [10-01-02] People v. Dela Cruz
 *       05-Mar   1.8   Internal Discussion — re Presentation of …
 *
 */

import type { LawyerEntry } from '@/lib/billing/breakdown-types';

export interface MatterGroup {
  /** Stable grouping key — the matter id, or `__none__` for entries with none. */
  key: string;
  /**
   * Heading text: "[code] Name", "Name" when the matter has no code, or `null`
   * when nothing identifies the matter. A null label means "render no heading",
   * which keeps invoices whose entries predate matter capture looking exactly
   * as they did before.
   */
  label: string | null;
  entries: LawyerEntry[];
}

const NO_MATTER = '__none__';

/** Label for entries carrying a matter id we couldn't resolve a name for. */
const UNNAMED_LABEL = 'General';

export function matterLabel(entry: LawyerEntry): string | null {
  const name = entry.matterName?.trim();
  if (!name) return entry.matterId ? UNNAMED_LABEL : null;
  const code = entry.matterCode?.trim();
  return code ? `[${code}] ${name}` : name;
}

/**
 * Group in matter-code order (the order the firm reads a bill in), with
 * unlabelled entries last. Entries keep their incoming order within a group,
 * which the callers have already sorted chronologically.
 */
export function groupEntriesByMatter(entries: LawyerEntry[]): MatterGroup[] {
  const groups = new Map<string, MatterGroup>();
  for (const e of entries) {
    const key = e.matterId ?? NO_MATTER;
    let g = groups.get(key);
    if (!g) {
      g = { key, label: matterLabel(e), entries: [] };
      groups.set(key, g);
    }
    g.entries.push(e);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === NO_MATTER) return 1;
    if (b.key === NO_MATTER) return -1;
    return (a.label ?? '').localeCompare(b.label ?? '', 'en', { numeric: true });
  });
}

/** Whether any heading would actually render — false for pre-matter invoices. */
export function hasMatterHeadings(groups: MatterGroup[]): boolean {
  return groups.some((g) => g.label !== null);
}
