import type { Home } from 'lucide-react';
import type { UserRole } from '@/lib/queries/team';
import type { FeatureFlags } from '@/lib/firm/feature-shape';
import { isRecentlyAdded, visiblePages } from '@/lib/nav/pages';

/**
 * The dashboard's "New for you" card: new tools from the sidebar (`addedOn`
 * within NEW_PAGE_DAYS) the person can open, in the words of their own
 * `description`, until they open or dismiss them. A new feature is announced
 * without anyone writing a second description of it. Pure and client-safe.
 */

export interface WhatsNewItem {
  /** The sidebar page's href, which also remembers a dismissal. */
  key: string;
  icon: typeof Home;
  title: string;
  body: string;
  action: { label: string; href: string };
  secondary?: { label: string; href: string };
  /** A to-do the person is asked to do, rather than a tool to look at. */
  todo?: boolean;
}

/**
 * What to show: new tools, newest first, that the person's role and their
 * firm's features let them open, leaving out whatever they have opened or
 * dismissed.
 */
export function whatsNewFor(
  role: UserRole,
  flags: FeatureFlags,
  seen: { hasVisited: (path: string) => boolean; hintDismissed: (path: string) => boolean },
  today?: string,
): WhatsNewItem[] {
  return visiblePages(role, 'dashboard', flags)
    .filter((p) => isRecentlyAdded(p, today) && !seen.hasVisited(p.href) && !seen.hintDismissed(p.href))
    .sort((a, b) => (a.addedOn < b.addedOn ? 1 : a.addedOn > b.addedOn ? -1 : 0))
    .map((p) => ({ key: p.href, icon: p.icon, title: p.label, body: p.description, action: { label: `Open ${p.label}`, href: p.href } }));
}
