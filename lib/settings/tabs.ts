/*
 * Personal Settings' tabs, chosen by `?tab=`: the same four in the dashboard
 * (/dashboard/settings) and the liaison shell (/liaison/settings). Profile is
 * the default, so an old /dashboard/settings link still opens on it.
 */

export const SETTINGS_TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'calendar', label: 'Calendar feed' },
  { key: 'security', label: 'Security' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['key'];

const KEYS: ReadonlySet<string> = new Set(SETTINGS_TABS.map((t) => t.key));

export function parseSettingsTab(v: string | string[] | null | undefined): SettingsTab {
  const s = Array.isArray(v) ? v[0] : v;
  return s && KEYS.has(s) ? (s as SettingsTab) : 'profile';
}

/** A tab's URL under the shell's own Settings path; Profile has no query. */
export function settingsTabHref(base: string, tab: SettingsTab): string {
  return tab === 'profile' ? base : `${base}?tab=${tab}`;
}

/** A plain left click, not one asking for a new tab or window, which the browser should handle. */
export function isInPlaceClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * Moves to another tab without a server navigation. Next's patched pushState
 * keeps the rendered tree and updates `useSearchParams`, so the page stays
 * mounted, and Back returns to the same tree rather than a cached render.
 */
export function switchSettingsTab(href: string): void {
  if (href === `${window.location.pathname}${window.location.search}`) return;
  window.history.pushState(null, '', href);
}
