import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_KEYS, type FeatureFlags } from '@/lib/firm/feature-shape';
import { canOpen, STAFF_ROLES } from './access';
import { HUBS, HUB_HREFS, hubFor, hubHrefs, type HubId } from './hubs';
import { NAV_AREAS } from './pages';

const NONE = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as FeatureFlags;
const ALL = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as FeatureFlags;
const hrefs = (hub: HubId, role: Parameters<typeof hubFor>[1], flags = ALL) =>
  hubFor(hub, role, flags).flatMap((s) => s.entries.map((e) => e.href));
const pageAt = (path: string) => {
  const segs = path.split('/').filter(Boolean);
  if (existsSync(join(process.cwd(), 'app', ...segs, 'page.tsx'))) return true;
  // The admin grid serves its tables at /admin/<table>.
  return segs.length === 2 && segs[0] === 'admin' && existsSync(join(process.cwd(), 'app', 'admin', '[entity]', 'page.tsx'));
};

describe('settings hubs', () => {
  it('link only to pages that exist, and each hub is a page', () => {
    for (const hub of Object.keys(HUBS) as HubId[]) {
      expect(pageAt(HUB_HREFS[hub]), HUB_HREFS[hub]).toBe(true);
      for (const href of hubHrefs(hub)) expect(pageAt(href), href).toBe(true);
    }
  });

  it('never show a role a page the route map refuses it', () => {
    for (const role of STAFF_ROLES) {
      for (const hub of Object.keys(HUBS) as HubId[]) {
        for (const href of hrefs(hub, role)) expect(canOpen(role, href), `${role} ${href}`).toBe(true);
      }
    }
  });

  it('show nothing to a role that cannot open the hub', () => {
    expect(hubFor('firm', 'lawyer', ALL)).toEqual([]);
    expect(hubFor('finance', 'admin', ALL)).toEqual([]);
  });

  it('give admin the firm setup and finance the parts it may open', () => {
    expect(hrefs('firm', 'admin')).toEqual(expect.arrayContaining(['/admin/settings/enums', '/admin/sla-rules', '/admin/ph_holidays']));
    expect(hrefs('firm', 'admin')).not.toContain('/admin/users');
    expect(hrefs('firm', 'super_user')).toContain('/admin/users');
    const finance = hrefs('firm', 'finance');
    expect(finance).toContain('/admin/fee-schedule');
    expect(finance).not.toContain('/admin/settings/enums');
    expect(finance).not.toContain('/admin/users');
  });

  it('leave out a page behind a feature the firm lacks', () => {
    expect(hrefs('firm', 'super_user', ALL)).toContain('/admin/portal-users');
    expect(hrefs('firm', 'super_user', NONE)).not.toContain('/admin/portal-users');
    expect(hrefs('firm', 'super_user', NONE)).not.toContain('/admin/integrations');
  });

  it('cover every setup page the sidebars no longer link', () => {
    const covered = new Set([...hubHrefs('firm'), ...hubHrefs('finance')]);
    const setup = [
      ...NAV_AREAS.admin.pages.filter((p) => (p.section === 'settings' || p.section === 'system') && p.sidebar === false),
      ...NAV_AREAS.finance.pages.filter((p) => p.section === 'configuration' && p.sidebar === false),
    ].filter((p) => !p.href.startsWith('/dashboard/'));
    for (const p of setup) expect(covered.has(p.href), p.href).toBe(true);
  });
});
