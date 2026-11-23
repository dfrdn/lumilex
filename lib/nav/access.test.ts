import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { UserRole } from '@/lib/queries/team';
import { canOpen, canOpenWithin, homeFor, refusedDestination, ROUTE_ACCESS, STAFF_ROLES } from './access';
import { NAV_AREAS, pagesForRole } from './pages';
import type { NavArea } from './types';

const L = 'lawyer', P = 'partner', A = 'admin', F = 'finance', S = 'super_user';
const C = 'chief_liaison_officer', O = 'liaison_officer';
const ROLES: UserRole[] = [L, P, A, F, S, C, O];

/*
 * What each role could open before the route map: proxy.ts's role chain, the
 * area layouts, and each page's own role check, as they stood at the commit
 * the map replaced them in. The replay below holds the map to it.
 */
function legacyCanOpen(role: UserRole, path: string): boolean {
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  const one = (...rs: UserRole[]) => rs.includes(role);

  if (under('/admin')) {
    if (!one(A, F, S)) return false; // proxy and layout
    if (['/admin/finalize', '/admin/integrations', '/admin/liaison-command', '/admin/portal-previews',
      '/admin/portal-users', '/admin/settings/enums', '/admin/signatures', '/admin/sla-rules'].some(under)) return one(A, S);
    if (under('/admin/users')) return one(S);
    return true;
  }
  if (under('/finance')) return one(F, S);
  if (under('/liaison')) {
    if (!one(O, C, A, S)) return false; // layout
    if (under('/liaison/my-errands')) return one(O, C, S);
    if (['/liaison/calendar', '/liaison/my-dtr', '/liaison/my-requests'].some(under)) return true;
    if (path === '/liaison') return one(C, A, S); // the page sent liaison officers on to My Errands
    return one(C, A, S);
  }
  if (under('/dashboard')) {
    if (path === '/dashboard') return !one(C, O); // the page sent liaison roles to their shell
    if (under('/dashboard/liaison-schedule')) return one(P, A, F, C, S);
    if (under('/dashboard/partner')) return one(P, S);
    if (under('/dashboard/affidavit-review') || under('/dashboard/red-team') || under('/dashboard/issuances')) return !one(C, O);
    if (under('/dashboard/prospects') || under('/dashboard/clients/portal-previews')) return one(P, A, S);
    if (/^\/dashboard\/clients\/[^/]+\/users(\/|$)/.test(path)) return one(P, A, S);
    return true;
  }
  if (under('/client-portal-preview')) return one(P, A, S);
  return true;
}

const APP = join(process.cwd(), 'app');
function pageRoutes(dir = APP, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) pageRoutes(full, out);
    else if (name === 'page.tsx') {
      const segs = relative(APP, full).split('/').slice(0, -1).filter((s) => !s.startsWith('('));
      out.push(`/${segs.map((s) => (s.startsWith('[') ? 'x' : s)).join('/')}`.replace(/\/$/, '') || '/');
    }
  }
  return out;
}

/** Pages that came with the map, so had no gate before it. */
const NEW_PAGES = ['/admin/more', '/finance/more', '/liaison/more', '/liaison/settings', '/liaison/schedule'];

/** Every page whose access differs between the map and before it, for a role: "+" now open, "-" now refused. */
function replay(): string[] {
  const diffs: string[] = [];
  for (const route of pageRoutes()) {
    if (NEW_PAGES.includes(route)) continue;
    for (const role of ROLES) {
      const before = legacyCanOpen(role, route);
      const now = canOpen(role, route);
      if (before !== now) diffs.push(`${now ? '+' : '-'} ${role} ${route}`);
    }
  }
  return diffs.sort();
}

describe('the route map against the gates it replaced', () => {
  it('opens no page to a role that could not open it before', () => {
    expect(replay().filter((d) => d.startsWith('+'))).toEqual([]);
  });

  it('refuses only what keeps liaison roles in their own shell', () => {
    const narrowed = replay().filter((d) => d.startsWith('-'));
    if (process.env.PRINT_REPLAY) console.log(narrowed.join('\n'));
    for (const d of narrowed) expect(d, d).toMatch(/^- (chief_liaison_officer|liaison_officer) \/dashboard\//);
    // Each refused liaison page they used has a twin in their shell, or none to need.
    expect(refusedDestination(O, '/dashboard/calendar')).toBe('/liaison/calendar');
    expect(refusedDestination(C, '/dashboard/liaison-schedule')).toBe('/liaison/schedule');
  });
});

describe('homeFor', () => {
  it('sends each role to its own shell, and super_user to the dashboard', () => {
    expect(ROLES.map(homeFor)).toEqual([
      '/dashboard', '/dashboard', '/admin', '/finance', '/dashboard', '/liaison', '/liaison/my-errands',
    ]);
    expect(homeFor(null)).toBe('/dashboard');
  });

  it('is a page the role may open', () => {
    for (const r of ROLES) expect(canOpen(r, homeFor(r))).toBe(true);
  });
});

describe('matching', () => {
  it('matches whole segments only', () => {
    expect(canOpen(L, '/admin')).toBe(false);
    expect(canOpen(L, '/admin/matters')).toBe(false);
    expect(canOpen(L, '/administrator')).toBe(true);
    expect(canOpen(F, '/admin/finalize')).toBe(false);
    expect(canOpen(L, '/financed')).toBe(true);
  });

  it('prefers a literal segment to a wildcard in the same place', () => {
    expect(canOpen(O, '/dashboard/deliverables/abc')).toBe(true);
    expect(canOpen(O, '/dashboard/deliverables/by-status')).toBe(false);
    expect(canOpen(O, '/dashboard/deliverables')).toBe(false);
    expect(canOpen(O, '/dashboard/deliverables?view=filings')).toBe(false);
    expect(canOpen('lawyer', '/dashboard/deliverables?view=filings')).toBe(true);
  });

  it('leaves public, portal, operator and API paths to the proxy', () => {
    for (const r of ROLES) {
      for (const p of ['/login', '/portal', '/portal/billing', '/intake', '/platform', '/api/deliverables']) {
        expect(canOpen(r, p)).toBe(true);
      }
    }
  });

  it('passes super_user everywhere', () => {
    for (const rule of ROUTE_ACCESS) expect(canOpen(S, rule.path.replace(/\*/g, 'x'))).toBe(true);
  });
});

describe('refusedDestination', () => {
  it('rewrites to where the same thing lives, keeping the rest of the path', () => {
    expect(refusedDestination(L, '/dashboard/clients/c1/users')).toBe('/dashboard/clients/c1');
    expect(refusedDestination(F, '/dashboard/clients/c1/users')).toBe('/dashboard/clients/c1');
    expect(refusedDestination(L, '/liaison/calendar')).toBe('/dashboard/calendar');
    expect(refusedDestination(P, '/liaison/schedule')).toBe('/dashboard/liaison-schedule');
    expect(refusedDestination(O, '/dashboard/settings')).toBe('/liaison/settings');
    expect(refusedDestination(L, '/admin/more')).toBe('/dashboard/tools');
  });

  it('falls back to home when the rewrite is refused too', () => {
    expect(refusedDestination(O, '/dashboard/clients/c1/users')).toBe('/liaison/my-errands');
    expect(refusedDestination(L, '/finance')).toBe('/dashboard');
    expect(refusedDestination(F, '/admin/users')).toBe('/finance');
  });

  it('is null for a page the role may open', () => {
    expect(refusedDestination(P, '/dashboard/partner')).toBeNull();
    expect(refusedDestination(A, '/liaison')).toBeNull();
  });
});

describe('area layouts', () => {
  it('admit a role that may open some page below the prefix', () => {
    expect(canOpenWithin(O, '/dashboard')).toBe(true); // deliverable links
    expect(canOpenWithin(L, '/admin')).toBe(false);
    expect(canOpenWithin(A, '/liaison')).toBe(true);
    expect(canOpenWithin(L, '/liaison')).toBe(false);
  });
});

describe('role gates agree', () => {
  const AREAS = Object.keys(NAV_AREAS) as NavArea[];

  it('never lists a page a role is refused, in any area', () => {
    for (const r of STAFF_ROLES) {
      for (const area of AREAS) {
        for (const p of pagesForRole(r, area)) expect(canOpen(r, p.href), `${r} ${p.href}`).toBe(true);
      }
    }
  });

  it('never sends a refused role to another page it is refused', () => {
    for (const rule of ROUTE_ACCESS) {
      for (const r of ROLES) {
        const dest = refusedDestination(r, rule.path.replace(/\*/g, 'x'));
        if (dest) expect(canOpen(r, dest), `${r} ${rule.path} → ${dest}`).toBe(true);
      }
    }
  });
});
