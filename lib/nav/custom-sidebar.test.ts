import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, canOpen } from './access';
import {
  NO_CHOICES, cleanChoices, customSidebar, movePin, placePin, readSavedSidebar, setAreaChoices, toggleHide, togglePin,
} from './custom-sidebar';
import { moreHrefFor } from './more';
import { NAV_AREAS, moreCountHrefs, pagesForRole, sidebarPagesForRole } from './pages';
import { FEATURE_KEYS, type FeatureFlags } from '@/lib/firm/feature-shape';
import type { NavArea } from './types';

const hrefs = (pages: { href: string }[]) => pages.map((p) => p.href);
const AREAS = Object.keys(NAV_AREAS) as NavArea[];
const ALL = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as FeatureFlags;
const NONE = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as FeatureFlags;

describe('customSidebar', () => {
  it('is the role default with no choices', () => {
    for (const role of STAFF_ROLES) {
      for (const area of AREAS) {
        const custom = customSidebar(role, area, ALL);
        expect(hrefs(custom.links)).toEqual(hrefs(sidebarPagesForRole(role, area, ALL)));
        expect(custom.pinned).toEqual([]);
        expect(custom.hidden).toEqual([]);
        expect(custom.moreCounts).toEqual(moreCountHrefs(role, area, ALL));
      }
    }
  });

  it('puts pins first in the order pinned, taking a pinned link out of its section', () => {
    const custom = customSidebar('lawyer', 'dashboard', ALL, {
      pins: ['/dashboard/tasks', '/dashboard/my-matters'],
      hides: [],
    });
    expect(hrefs(custom.pinned)).toEqual(['/dashboard/tasks', '/dashboard/my-matters']);
    expect(hrefs(custom.links)).not.toContain('/dashboard/my-matters');
  });

  it('pins a page of another area the role can open', () => {
    expect(canOpen('admin', '/dashboard/calendar')).toBe(true);
    const custom = customSidebar('admin', 'admin', ALL, { pins: ['/dashboard/calendar'], hides: [] });
    expect(hrefs(custom.pinned)).toEqual(['/dashboard/calendar']);
  });

  it('never widens access: a pin the role cannot open drops out silently', () => {
    expect(canOpen('lawyer', '/admin/users')).toBe(false);
    expect(canOpen('lawyer', '/finance')).toBe(false);
    const custom = customSidebar('lawyer', 'dashboard', ALL, {
      pins: ['/admin/users', '/finance', '/dashboard/tasks'],
      hides: [],
    });
    expect(hrefs(custom.pinned)).toEqual(['/dashboard/tasks']);
  });

  it('every pin it returns is a page the role can open, for any saved list', () => {
    const everything = AREAS.flatMap((a) => NAV_AREAS[a].pages.map((p) => p.href));
    for (const role of STAFF_ROLES) {
      for (const area of AREAS) {
        const { pinned } = customSidebar(role, area, ALL, { pins: everything, hides: [] });
        for (const href of hrefs(pinned)) expect(canOpen(role, href), `${role} ${href}`).toBe(true);
      }
    }
  });

  it('ignores hrefs it does not know, and repeats', () => {
    const custom = customSidebar('lawyer', 'dashboard', ALL, {
      pins: ['https://example.com', '/not-a-page', '/dashboard/tasks', '/dashboard/tasks'],
      hides: ['/not-a-page'],
    });
    expect(hrefs(custom.pinned)).toEqual(['/dashboard/tasks']);
    expect(custom.hidden).toEqual([]);
  });

  it('lists hidden links so they can come back, and a pin beats a hide', () => {
    const hidden = customSidebar('lawyer', 'dashboard', ALL, { pins: [], hides: ['/dashboard/my-dtr'] });
    expect(hrefs(hidden.links)).not.toContain('/dashboard/my-dtr');
    expect(hrefs(hidden.hidden)).toEqual(['/dashboard/my-dtr']);

    const both = customSidebar('lawyer', 'dashboard', ALL, { pins: ['/dashboard/my-dtr'], hides: ['/dashboard/my-dtr'] });
    expect(hrefs(both.pinned)).toEqual(['/dashboard/my-dtr']);
    expect(both.hidden).toEqual([]);
  });

  it('hides only act on the area they were saved for', () => {
    const custom = customSidebar('admin', 'admin', ALL, { pins: [], hides: ['/dashboard/my-dtr'] });
    expect(custom.hidden).toEqual([]);
  });
});

describe('counts under customization', () => {
  it('a hidden link hands its count to More', () => {
    const before = customSidebar('lawyer', 'dashboard', ALL).moreCounts;
    expect(before).not.toContain('/dashboard/my-dtr');
    const after = customSidebar('lawyer', 'dashboard', ALL, { pins: [], hides: ['/dashboard/my-dtr'] }).moreCounts;
    expect(after).toContain('/dashboard/my-dtr');
  });

  it('a pinned page counts on its own link, not on More as well', () => {
    expect(moreCountHrefs('partner', 'dashboard', ALL)).toContain('/dashboard/partner/finance-overview');
    const after = customSidebar('partner', 'dashboard', ALL, { pins: ['/dashboard/partner/finance-overview'], hides: [] }).moreCounts;
    expect(after).not.toContain('/dashboard/partner/finance-overview');
  });

  it('Chat stays on the header button, hidden or not', () => {
    expect(customSidebar('lawyer', 'dashboard', ALL, { pins: [], hides: ['/chat'] }).moreCounts).not.toContain('/chat');
  });

  it('every role that sees an area has a More for a hidden count to land on', () => {
    for (const role of STAFF_ROLES) {
      for (const area of AREAS) {
        if (pagesForRole(role, area).length > 0) expect(moreHrefFor(role, area), `${role} ${area}`).not.toBeNull();
      }
    }
  });
});

describe('choices', () => {
  it('pinning brings back a hidden link, hiding unpins', () => {
    const hiddenFirst = { pins: [], hides: ['/dashboard/tasks'] };
    expect(togglePin(hiddenFirst, '/dashboard/tasks')).toEqual({ pins: ['/dashboard/tasks'], hides: [] });
    const pinnedFirst = { pins: ['/dashboard/tasks'], hides: [] };
    expect(toggleHide(pinnedFirst, '/dashboard/tasks')).toEqual({ pins: [], hides: ['/dashboard/tasks'] });
  });

  it('toggles back off', () => {
    expect(togglePin(togglePin(NO_CHOICES, '/dashboard/tasks'), '/dashboard/tasks')).toEqual(NO_CHOICES);
    expect(toggleHide(toggleHide(NO_CHOICES, '/dashboard/tasks'), '/dashboard/tasks')).toEqual(NO_CHOICES);
  });

  it('keeps only registered pages when cleaning', () => {
    expect(cleanChoices({
      pins: ['/dashboard/tasks', '/dashboard/tasks', '/nope', 7],
      hides: ['/dashboard/tasks', '/dashboard/my-dtr'],
    })).toEqual({ pins: ['/dashboard/tasks'], hides: ['/dashboard/my-dtr'] });
    expect(cleanChoices('nonsense')).toEqual(NO_CHOICES);
  });

  it('reads anything stored without throwing, dropping empty areas and unknown keys', () => {
    expect(readSavedSidebar(null)).toEqual({});
    expect(readSavedSidebar('x')).toEqual({});
    expect(readSavedSidebar({ dashboard: { pins: 3 }, portal: { pins: ['/dashboard/tasks'] } })).toEqual({});
    expect(readSavedSidebar({ admin: { pins: ['/dashboard/calendar'], hides: [] } })).toEqual({
      admin: { pins: ['/dashboard/calendar'], hides: [] },
    });
  });

  it('replaces one area and leaves the others; an empty area is removed', () => {
    const saved = { dashboard: { pins: ['/dashboard/tasks'], hides: [] }, admin: { pins: [], hides: ['/admin'] } };
    expect(setAreaChoices(saved, 'dashboard', null)).toEqual({ admin: saved.admin });
    expect(setAreaChoices(saved, 'admin', NO_CHOICES)).toEqual({ dashboard: saved.dashboard });
  });
});

describe('reordering pins', () => {
  const A = '/dashboard/tasks';
  const B = '/dashboard/my-matters';
  const C = '/dashboard/clients';
  const STALE = '/admin/users';
  const choices = { pins: [A, STALE, B, C], hides: ['/dashboard/my-dtr'] };
  const shown = [A, B, C];

  it('moves a pin one place, past a saved pin nobody sees, and keeps that one after the shown pins', () => {
    expect(movePin(choices, shown, B, -1)).toEqual({ pins: [B, A, C, STALE], hides: ['/dashboard/my-dtr'] });
    expect(movePin(choices, shown, A, 1).pins).toEqual([B, A, C, STALE]);
  });

  it('leaves the edges and unknown pins alone, returning the same choices', () => {
    expect(movePin(choices, shown, A, -1)).toBe(choices);
    expect(movePin(choices, shown, C, 1)).toBe(choices);
    expect(movePin(choices, shown, '/dashboard/cases', 1)).toBe(choices);
  });

  it('drops a pin where the target was, either way', () => {
    expect(placePin(choices, shown, A, C).pins).toEqual([B, C, A, STALE]);
    expect(placePin(choices, shown, C, A).pins).toEqual([C, A, B, STALE]);
    expect(placePin(choices, shown, B, C).pins).toEqual([A, C, B, STALE]);
    expect(placePin(choices, shown, B, B)).toBe(choices);
  });

  it('the merged sidebar draws pins in the new order', () => {
    const next = movePin({ pins: shown, hides: [] }, shown, C, -1);
    expect(hrefs(customSidebar('lawyer', 'dashboard', ALL, next).pinned)).toEqual([A, C, B]);
  });
});

describe('features', () => {
  it('drops a pin to a page behind a feature the firm lacks', () => {
    const choices = { pins: ['/dashboard/drafting', '/dashboard/tasks'], hides: [] };
    expect(hrefs(customSidebar('lawyer', 'dashboard', ALL, choices).pinned)).toEqual(['/dashboard/drafting', '/dashboard/tasks']);
    expect(hrefs(customSidebar('lawyer', 'dashboard', NONE, choices).pinned)).toEqual(['/dashboard/tasks']);
  });
});
