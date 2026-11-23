import { describe, it, expect } from 'vitest';
import { whatsNewFor } from './whats-new';
import { NAV_AREAS, NEW_PAGE_DAYS, pagesForRole } from '@/lib/nav/pages';
import { addDays } from '@/lib/dates';
import { FEATURE_KEYS, type FeatureFlags } from '@/lib/firm/feature-shape';

const none = { hasVisited: () => false, hintDismissed: () => false };
const ALL = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as FeatureFlags;
const NONE = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as FeatureFlags;

// A day inside the "New" window of the newest page the lawyer sidebar holds,
// so the test holds whatever pages are added later.
const newest = pagesForRole('lawyer').map((p) => p.addedOn).sort().at(-1)!;
const TODAY = addDays(newest, 1);

describe('whatsNewFor', () => {
  it('lists the new tools a role can open, newest first, in their sidebar words', () => {
    const items = whatsNewFor('lawyer', ALL, none, TODAY);
    expect(items.length).toBeGreaterThan(0);
    const dates = items.map((i) => NAV_AREAS.dashboard.pages.find((p) => p.href === i.key)!.addedOn);
    expect([...dates].sort().reverse()).toEqual(dates);
    const first = NAV_AREAS.dashboard.pages.find((p) => p.href === items[0].key)!;
    expect(items[0].body).toBe(first.description);
    expect(items[0].action.href).toBe(first.href);
  });

  it('is empty once the window has passed', () => {
    expect(whatsNewFor('lawyer', ALL, none, addDays(newest, NEW_PAGE_DAYS + 1))).toEqual([]);
  });

  it('drops what the person opened or dismissed', () => {
    const items = whatsNewFor('lawyer', ALL, none, TODAY);
    const [opened, hidden] = [items[0]?.key, items[1]?.key];
    const seen = { hasVisited: (p: string) => p === opened, hintDismissed: (p: string) => p === hidden };
    const keys = whatsNewFor('lawyer', ALL, seen, TODAY).map((i) => i.key);
    expect(keys).not.toContain(opened);
    if (hidden) expect(keys).not.toContain(hidden);
  });

  it('never announces a page the role or the firm cannot open', () => {
    const lawyer = new Set(pagesForRole('lawyer').map((p) => p.href));
    for (const item of whatsNewFor('lawyer', ALL, none, TODAY)) expect(lawyer.has(item.key)).toBe(true);
    const gated = new Set(NAV_AREAS.dashboard.pages.filter((p) => p.features?.length).map((p) => p.href));
    for (const item of whatsNewFor('partner', NONE, none, TODAY)) expect(gated.has(item.key)).toBe(false);
  });
});
