import { describe, it, expect } from 'vitest';
import { STAFF_ROLES, canOpen, canOpenWithin, refusedDestination } from './access';
import { NAV_AREAS, MORE_HREF, pagesForRole, sidebarPagesForRole, searchPages } from './pages';
import { MORE_HREFS, filterMore, moreContext, moreEntries, moreForRole, moreHrefFor, moreItems } from './more';
import { FEATURE_KEYS, type FeatureFlags } from '@/lib/firm/feature-shape';

const ALL = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as FeatureFlags;
import type { NavArea } from './types';

const AREAS = Object.keys(NAV_AREAS) as NavArea[];
const hrefs = (items: { page: { href: string } }[]) => items.map((i) => i.page.href);

/** The view the tests read More from: the dashboard for those who may open its More, else the liaison shell. */
const viewOf = (role: (typeof STAFF_ROLES)[number]): NavArea => (canOpen(role, MORE_HREF) ? 'dashboard' : 'liaison');

const AREA_ROOTS: Record<NavArea, string> = { dashboard: '/dashboard', admin: '/admin', finance: '/finance', liaison: '/liaison' };

describe('moreHrefFor', () => {
  it('opens the More of the shell it is clicked in, so More never leaves the shell', () => {
    for (const role of STAFF_ROLES) {
      for (const area of AREAS.filter((a) => a !== 'dashboard')) {
        if (!canOpenWithin(role, AREA_ROOTS[area])) continue;
        expect(moreHrefFor(role, area), `${role} in ${area}`).toBe(MORE_HREFS[area]);
      }
    }
    expect(moreHrefFor('admin', 'admin')).toBe('/admin/more');
    expect(moreHrefFor('finance', 'finance')).toBe('/finance/more');
    expect(moreHrefFor('finance', 'admin')).toBe('/admin/more');
    expect(moreHrefFor('admin', 'liaison')).toBe('/liaison/more');
    expect(moreHrefFor('lawyer', 'dashboard')).toBe(MORE_HREF);
  });

  it('sends a role that can\'t open a shell\'s More to one it can', () => {
    expect(moreHrefFor('liaison_officer', 'dashboard')).toBe('/liaison/more');
    expect(moreHrefFor('chief_liaison_officer', 'dashboard')).toBe('/liaison/more');
  });

  it('never offers a More the role is refused', () => {
    for (const role of STAFF_ROLES) {
      for (const area of AREAS) {
        const href = moreHrefFor(role, area);
        expect(href, `${role} in ${area}`).not.toBeNull();
        expect(canOpen(role, href!), `${role} in ${area}`).toBe(true);
      }
    }
  });

  it('sends a role refused a More to its own', () => {
    expect(refusedDestination('lawyer', '/admin/more')).toBe(MORE_HREF);
    expect(refusedDestination('liaison_officer', '/finance/more')).toBe('/liaison/more');
    expect(refusedDestination('admin', '/finance/more')).toBe('/admin/more');
    expect(refusedDestination('finance', '/liaison/more')).toBe('/finance/more');
    expect(refusedDestination('partner', '/liaison/more')).toBe(MORE_HREF);
  });
});

describe('More search', () => {
  const firstShown = (role: (typeof STAFF_ROLES)[number], view: NavArea, query: string) => {
    const all = moreForRole(role, view, ALL);
    const where = new Map(moreEntries(all).map((e) => [e.item.page.href, e]));
    return searchPages(moreItems(all).map((i) => i.page), query).map((p) => where.get(p.href)!);
  };

  it('lists the hits in rank order, so Enter opens the first card shown', () => {
    expect(firstShown('lawyer', 'dashboard', 'matters')[0].item.page.href).toBe('/dashboard/matters');
    expect(firstShown('admin', 'admin', 'sign')[0].item.page.label.toLowerCase()).toMatch(/^sign/);
    for (const hit of firstShown('super_user', 'dashboard', 're')) expect(hit, 'every hit has its headings').toBeDefined();
  });

  it('names where each hit lives', () => {
    const [billing] = firstShown('partner', 'dashboard', 'billing review');
    expect(moreContext(billing, false)).toBe('Partner · Approvals');
    const [myMatters] = firstShown('admin', 'admin', 'my matters');
    expect(myMatters.item.page.href).toBe('/dashboard/my-matters');
    expect(moreContext(myMatters, true)).toBe('Dashboard · Matters');
  });
});

describe('More', () => {
  it('lists every page a role can open exactly once, from every area', () => {
    for (const role of STAFF_ROLES) {
      for (const view of AREAS) {
        const listed = hrefs(moreItems(moreForRole(role, view, ALL)));
        expect(new Set(listed).size, `${role} from ${view}`).toBe(listed.length);
        const openable = new Set(AREAS.flatMap((a) => pagesForRole(role, a).map((p) => p.href)));
        expect(new Set(listed), `${role} from ${view}`).toEqual(openable);
        for (const href of listed) expect(canOpen(role, href), `${role}: ${href}`).toBe(true);
      }
    }
  });

  it('tags exactly the pages in that area\'s sidebar, and lists them first under each heading', () => {
    for (const role of STAFF_ROLES) {
      for (const area of moreForRole(role, viewOf(role), ALL)) {
        const sidebar = new Set(sidebarPagesForRole(role, area.area, ALL).map((p) => p.href));
        for (const group of area.groups) {
          const lists = group.subgroups ? group.subgroups.map((s) => s.items) : [group.items];
          for (const items of lists) {
            for (const item of items) expect(item.inSidebar, `${role}: ${item.page.href}`).toBe(sidebar.has(item.page.href));
            const flags = items.map((i) => i.inSidebar);
            expect(flags, `${role}: ${group.id}`).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
          }
        }
      }
    }
  });

  it('keeps the sidebar\'s headings in the sidebar\'s order, with the partner sub-headings', () => {
    const order = NAV_AREAS.dashboard.sections.map((s) => s.id);
    for (const role of ['lawyer', 'partner', 'admin', 'finance', 'super_user'] as const) {
      const dashboard = moreForRole(role, 'dashboard', ALL)[0];
      expect(dashboard.area, role).toBe('dashboard');
      const ids = dashboard.groups.map((g) => g.id);
      expect(ids, role).toEqual(order.filter((id) => ids.includes(id)));
    }
    expect(moreForRole('lawyer', 'dashboard', ALL)[0].groups.map((g) => g.label)).toEqual(
      ['Today', 'Matters', 'Practice', 'Draft & research', 'Me'],
    );
    const partner = moreForRole('partner', 'dashboard', ALL)[0].groups.find((g) => g.id === 'partner')!;
    expect(partner.partner).toBe(true);
    expect(partner.subgroups!.map((s) => s.label)).toEqual(['Approvals', 'Oversight', 'Pipeline', 'Reference']);
    expect(hrefs(partner.subgroups![0].items)).toEqual([
      '/dashboard/partner/pre-finalizing', '/dashboard/partner/billing-review', '/dashboard/partner/leaves', '/dashboard/partner/feedbacks',
    ]);
    expect(hrefs(partner.items)).toEqual(partner.subgroups!.flatMap((s) => hrefs(s.items)));
  });

  it('shows a lawyer and a partner only the dashboard, and the other roles each area they can open', () => {
    const areas = (role: (typeof STAFF_ROLES)[number]) => moreForRole(role, viewOf(role), ALL).map((a) => a.area);
    expect(areas('lawyer')).toEqual(['dashboard']);
    expect(areas('partner')).toEqual(['dashboard']);
    expect(areas('admin')).toEqual(['dashboard', 'admin', 'liaison']);
    expect(areas('finance')).toEqual(['dashboard', 'admin', 'finance']);
    expect(areas('super_user')).toEqual(['dashboard', 'admin', 'finance', 'liaison']);
    expect(areas('liaison_officer')).toEqual(['liaison']);
    expect(areas('chief_liaison_officer')).toEqual(['liaison']);
    expect(moreForRole('admin', 'dashboard', ALL).map((a) => a.label)).toEqual(['Dashboard', 'Admin', 'Liaison']);
  });

  it('lists Chat once for liaison roles, under their own area', () => {
    const [liaison] = moreForRole('liaison_officer', 'liaison', ALL);
    expect(hrefs(liaison.groups.flatMap((g) => g.items)).filter((h) => h === '/chat')).toHaveLength(1);
  });

  it('gives every heading an anchor, unique on the page', () => {
    for (const role of STAFF_ROLES) {
      const all = moreForRole(role, viewOf(role), ALL);
      const anchors = all.flatMap((a) => [a.anchor, ...a.groups.flatMap((g) => [g.anchor, ...(g.subgroups ?? []).map((s) => s.anchor)])]);
      expect(new Set(anchors).size, role).toBe(anchors.length);
      for (const anchor of anchors) expect(anchor, role).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    const partner = moreForRole('partner', 'dashboard', ALL)[0].groups.find((g) => g.id === 'partner')!;
    expect(partner.anchor).toBe('partner');
    expect(partner.subgroups![0].anchor).toBe('partner-approvals');
    expect(moreForRole('admin', 'dashboard', ALL)[1].groups[0].anchor).toBe('admin-main');
  });

  it('finds Settings by search for every role, though no office sidebar links it', () => {
    for (const role of STAFF_ROLES) {
      const pages = moreItems(moreForRole(role, viewOf(role), ALL)).map((i) => i.page);
      const want = viewOf(role) === 'liaison' ? '/liaison/settings' : '/dashboard/settings';
      expect(searchPages(pages, 'settings').map((p) => p.href), role).toContain(want);
      expect(searchPages(pages, 'password').map((p) => p.href)[0], role).toBe(want);
    }
    const me = moreForRole('lawyer', 'dashboard', ALL)[0].groups.find((g) => g.id === 'me')!;
    expect(me.items.find((i) => i.page.href === '/dashboard/settings')?.inSidebar).toBe(false);
  });

  it('drops headings a filter leaves empty', () => {
    const narrowed = filterMore(moreForRole('partner', 'dashboard', ALL), (p) => p.href === '/dashboard/partner/feedbacks');
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0].groups.map((g) => g.id)).toEqual(['partner']);
    expect(narrowed[0].groups[0].subgroups!.map((s) => s.id)).toEqual(['approvals']);
    expect(filterMore(moreForRole('lawyer', 'dashboard', ALL), () => false)).toEqual([]);
  });

});
