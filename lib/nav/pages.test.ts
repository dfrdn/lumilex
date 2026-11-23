import { describe, it, expect } from 'vitest';
import {
  NAV_AREAS, ALL_PAGES, pagesForRole, sidebarPagesForRole, visiblePages, moreCountHrefs, foldedByDefault,
  pageForPath, searchPages, isRecentlyAdded, areaForPath, isPageActive,
} from './pages';
import { canOpen, STAFF_ROLES } from './access';
import { FEATURE_KEYS, type FeatureFlags } from '@/lib/firm/feature-shape';

const NAV_PAGES = NAV_AREAS.dashboard.pages;
const hrefs = (pages: { href: string }[]) => pages.map((p) => p.href);
const NONE = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as FeatureFlags;
const ALL = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as FeatureFlags;

describe('the default sidebars', () => {
  it('gives a lawyer the pages of a working day, the rest in More', () => {
    expect(hrefs(sidebarPagesForRole('lawyer', 'dashboard', ALL))).toEqual([
      '/dashboard', '/dashboard/calendar',
      '/dashboard/my-matters', '/dashboard/deliverables', '/dashboard/matters', '/dashboard/clients',
      '/dashboard/cases', '/dashboard/corporations', '/dashboard/trademarks',
      '/dashboard/drafting', '/dashboard/library', '/dashboard/search', '/dashboard/issuances',
      '/dashboard/my-dtr', '/dashboard/my-submissions',
    ]);
  });

  it('adds the partner overview and approvals, which carry counts', () => {
    const partner = hrefs(sidebarPagesForRole('partner', 'dashboard', ALL));
    expect(partner.slice(-5)).toEqual([
      '/dashboard/partner', '/dashboard/partner/pre-finalizing', '/dashboard/partner/billing-review',
      '/dashboard/partner/leaves', '/dashboard/partner/feedbacks',
    ]);
  });

  it('drops a feature-gated link for a firm without the feature', () => {
    const shown = hrefs(sidebarPagesForRole('lawyer', 'dashboard', NONE));
    expect(shown).not.toContain('/dashboard/drafting');
    expect(shown).not.toContain('/dashboard/search');
    expect(shown).toContain('/dashboard/library');
  });
});

describe('pagesForRole', () => {
  it('offers liaison roles only Chat on the dashboard', () => {
    expect(hrefs(pagesForRole('liaison_officer'))).toEqual(['/chat']);
    expect(hrefs(pagesForRole('chief_liaison_officer'))).toEqual(['/chat']);
  });

  it('keeps Liaison Schedule from lawyers', () => {
    expect(hrefs(pagesForRole('lawyer'))).not.toContain('/dashboard/liaison-schedule');
    expect(hrefs(pagesForRole('partner'))).toContain('/dashboard/liaison-schedule');
  });

  it('shows the partner block to partners and super users only', () => {
    expect(hrefs(pagesForRole('partner'))).toContain('/dashboard/partner/billing-review');
    expect(hrefs(pagesForRole('super_user'))).toContain('/dashboard/partner/billing-review');
    expect(hrefs(pagesForRole('lawyer'))).not.toContain('/dashboard/partner/billing-review');
    expect(hrefs(pagesForRole('admin'))).not.toContain('/dashboard/partner');
  });

  it('never lists a page the route map refuses', () => {
    for (const role of STAFF_ROLES) {
      for (const area of Object.keys(NAV_AREAS) as (keyof typeof NAV_AREAS)[]) {
        for (const p of pagesForRole(role, area)) expect(canOpen(role, p.href), `${role} ${p.href}`).toBe(true);
      }
    }
  });
});

describe('visiblePages', () => {
  it('drops every feature-gated page for a firm without the feature', () => {
    const shown = hrefs(visiblePages('partner', 'dashboard', NONE));
    for (const gated of ['/dashboard/search', '/dashboard/drafting', '/dashboard/affidavit-review', '/dashboard/red-team', '/dashboard/issuances']) {
      expect(shown).not.toContain(gated);
    }
    expect(hrefs(visiblePages('super_user', 'admin', NONE))).not.toContain('/admin/portal-users');
    expect(hrefs(visiblePages('super_user', 'admin', ALL))).toContain('/admin/portal-users');
  });
});

describe('More counts', () => {
  it('roll up the counts of pages with no sidebar link, never Chat', () => {
    const hidden = moreCountHrefs('partner', 'dashboard', ALL);
    expect(hidden).toContain('/dashboard/partner/finance-overview');
    expect(hidden).not.toContain('/dashboard/partner/leaves');
    expect(hidden).not.toContain('/chat');
  });
});

describe('folding', () => {
  it('folds the long groups for partners by default', () => {
    expect(foldedByDefault('dashboard', 'matters', 'partner')).toBe(true);
    expect(foldedByDefault('dashboard', 'matters', 'lawyer')).toBe(false);
  });
});

describe('pageForPath', () => {
  it('matches a page and anything under it, preferring the longest href', () => {
    expect(pageForPath('/dashboard/red-team/42')?.href).toBe('/dashboard/red-team');
    expect(pageForPath('/dashboard/partner/clients/abc')?.href).toBe('/dashboard/partner/clients');
    expect(pageForPath('/dashboard/prospects/proposals/p1')?.href).toBe('/dashboard/prospects/proposals');
  });

  it('counts the dashboard only on its own path', () => {
    expect(pageForPath('/dashboard')?.href).toBe('/dashboard');
    expect(pageForPath('/dashboard/unknown')).toBeNull();
    expect(pageForPath('/dashboard/settings')?.href).toBe('/dashboard/settings');
  });
});

describe('searchPages', () => {
  it('finds a page by a keyword it does not show', () => {
    expect(hrefs(searchPages(NAV_PAGES, 'invoice'))).toContain('/dashboard/partner/billing-review');
    expect(hrefs(searchPages(NAV_PAGES, 'timesheet'))).toEqual(['/dashboard/my-dtr']);
  });

  it('ranks a label match first and needs every word', () => {
    expect(searchPages(NAV_PAGES, 'red')[0].href).toBe('/dashboard/red-team');
    expect(hrefs(searchPages(NAV_PAGES, 'citation pleading'))).toEqual(['/dashboard/red-team']);
  });
});

describe('isRecentlyAdded', () => {
  const page = { ...NAV_PAGES[0], addedOn: '2026-10-01' };
  it('is new for 45 days', () => {
    expect(isRecentlyAdded(page, '2026-11-15')).toBe(true);
    expect(isRecentlyAdded(page, '2026-11-16')).toBe(false);
  });
});

describe('NAV_AREAS', () => {
  it('has one entry per href in each area, each in a known section, with a description and a date', () => {
    for (const { sections, pages } of Object.values(NAV_AREAS)) {
      expect(new Set(hrefs(pages)).size).toBe(pages.length);
      const sectionIds = new Set(sections.map((s) => s.id));
      for (const p of pages) {
        expect(sectionIds.has(p.section)).toBe(true);
        expect(p.description.length).toBeGreaterThan(10);
        expect(p.addedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe('areas', () => {
  it('finds the area for a path', () => {
    expect(areaForPath('/admin/matters/abc')).toBe('admin');
    expect(areaForPath('/finance/invoices')).toBe('finance');
    expect(areaForPath('/liaison/more')).toBe('liaison');
    expect(areaForPath('/administrator')).toBe('dashboard');
  });

  it('marks a page active only where its sidebar did', () => {
    const overview = ALL_PAGES.find((p) => p.href === '/admin')!;
    expect(isPageActive(overview, '/admin/matters')).toBe(false);
    const prospects = ALL_PAGES.find((p) => p.href === '/dashboard/prospects')!;
    expect(isPageActive(prospects, '/dashboard/prospects/abc')).toBe(true);
    expect(isPageActive(prospects, '/dashboard/prospects/proposals')).toBe(false);
  });
});

describe('deliverables views in search', () => {
  it('opens the view a person searches for, not the default list', () => {
    const lawyer = pagesForRole('lawyer');
    expect(searchPages(lawyer, 'status reports')[0].href).toBe('/dashboard/deliverables?view=status-reports');
    expect(searchPages(lawyer, 'filings')[0].href).toBe('/dashboard/deliverables?view=filings');
    expect(searchPages(lawyer, 'internal')[0].href).toBe('/dashboard/deliverables?view=internal');
  });

  it('finds My Deliverables by its old names', () => {
    const lawyer = pagesForRole('lawyer');
    expect(searchPages(lawyer, 'my deliverables')[0].href).toBe('/dashboard/deliverables');
    expect(searchPages(lawyer, 'deliverables').map((p) => p.href)).toContain('/dashboard/deliverables');
    expect(searchPages(lawyer, 'all deliverables')[0].href).toBe('/dashboard/deliverables');
  });

  it('labels the sidebar link for the person and leaves the admin database alone', () => {
    const sidebar = sidebarPagesForRole('lawyer', 'dashboard', ALL);
    expect(sidebar.find((p) => p.href === '/dashboard/deliverables')?.label).toBe('My Deliverables');
    const database = ALL_PAGES.find((p) => p.href === '/admin/deliverables');
    expect(database?.label).toBe('Deliverables');
    expect(database?.section).toBe('databases');
  });
});

describe('calendar tabs in search', () => {
  it('opens the tab a person searches for, not the month calendar', () => {
    const lawyer = pagesForRole('lawyer');
    expect(searchPages(lawyer, 'hearings')[0].href).toBe('/dashboard/calendar?tab=hearings');
    expect(searchPages(lawyer, 'meetings')[0].href).toBe('/dashboard/calendar?tab=meetings');
  });

  it('keeps the month calendar as the Calendar page', () => {
    expect(pageForPath('/dashboard/calendar')?.label).toBe('Calendar');
  });
});
