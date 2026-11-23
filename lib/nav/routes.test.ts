import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ALL_PAGES } from './pages';
import { ROUTE_ACCESS } from './access';
import { ENTITY_CONFIGS } from '@/lib/admin/entity-config';

const ROOT = process.cwd();
const APP = join(ROOT, 'app');

function filesNamed(names: string[], dir = APP, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesNamed(names, full, out);
    else if (names.includes(name)) out.push(relative(ROOT, full));
  }
  return out;
}

/** '/dashboard/matters/[id]' for app/dashboard/matters/[id]/page.tsx (route groups dropped). */
function routeOf(file: string): string {
  const segs = file.split('/').slice(1, -1).filter((s) => !s.startsWith('('));
  return `/${segs.join('/')}`;
}

const PAGES = filesNamed(['page.tsx']);
const ROUTES = new Map(PAGES.map((f) => [routeOf(f), f]));

/*
 * Page guards. A page or layout that sends someone away because of their role
 * reads the route map (lib/nav/guard.ts, lib/nav/access.ts) instead of
 * comparing roles itself, so the proxy, the guard and the nav can't drift.
 * What stays inline is a check about a person or a record, not a role.
 */
const GUARD_ALLOWLIST: Record<string, string> = {};

/** The condition of every `if (…)` whose consequent is a redirect, plus every redirect whose target is computed. */
function roleRedirects(src: string): string[] {
  const found: string[] = [];
  const re = /\bif\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    const cond = src.slice(m.index + m[0].length, i - 1);
    const after = src.slice(i).replace(/^\s*\{?\s*/, '');
    if (!after.startsWith('redirect(')) continue;
    const bare = cond.trim().replace(/^!/, '');
    const assigned = /^\w+$/.test(bare) ? new RegExp(`const ${bare}\\s*=([^;]*);`).exec(src)?.[1] ?? '' : '';
    if (/\brole\b|\.role\b/.test(cond + assigned)) found.push(cond.trim());
  }
  for (const r of src.matchAll(/\bredirect\(([^;]*\brole\b[^;]*)\);/g)) {
    if (!/\b(homeFor|refusedDestination)\(/.test(r[1])) found.push(r[1]);
  }
  return found;
}

describe('page guards', () => {
  it('read the route map instead of comparing roles', () => {
    const offenders: string[] = [];
    for (const file of filesNamed(['page.tsx', 'layout.tsx'])) {
      if (GUARD_ALLOWLIST[file]) continue;
      const hits = roleRedirects(readFileSync(join(ROOT, file), 'utf8'));
      if (hits.length) offenders.push(`${file}: ${hits.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('allowlists only files that still have an inline role check', () => {
    for (const file of Object.keys(GUARD_ALLOWLIST)) {
      expect(roleRedirects(readFileSync(join(ROOT, file), 'utf8')).length, file).toBeGreaterThan(0);
    }
  });

  it('catches the shapes a role gate takes', () => {
    expect(roleRedirects("if (role !== 'admin') redirect('/x');")).toHaveLength(1);
    expect(roleRedirects("if (!['a', 'b'].includes(role)) {\n  redirect('/x');\n}")).toHaveLength(1);
    expect(roleRedirects("const allowed = role === 'a' || role === 'b';\nif (!allowed) redirect('/x');")).toHaveLength(1);
    expect(roleRedirects("redirect(role === 'finance' ? '/finance' : '/dashboard');")).toHaveLength(1);
    expect(roleRedirects('if (session) redirect(homeFor(session.user.role));')).toHaveLength(0);
    expect(roleRedirects("if (!session?.user?.notionUserId) redirect('/login');")).toHaveLength(0);
    expect(roleRedirects("if (!(await isManagingPartner(session.user.notionUserId))) redirect('/x');")).toHaveLength(0);
  });
});

/*
 * Guard paths. A page's requireRouteAccess, and a layout's requireAreaAccess,
 * name the file's own route: its literal path, with a `${…}` (or anything) for
 * each dynamic segment. A guard copied from another page would otherwise apply
 * that page's rule without a sound.
 */

/** The argument text of every requireRouteAccess / requireAreaAccess call in a file. */
function guardArgs(src: string): string[] {
  const args: string[] = [];
  const re = /\brequire(?:Route|Area)Access\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    args.push(src.slice(m.index + m[0].length, i - 1).trim());
  }
  return args;
}

/** The path a guard passes, each `${…}` as `*`; null when it isn't a string or template literal. */
function guardPath(arg: string): string | null {
  const m = /^(['"`])([^'"`]*)\1$/.exec(arg);
  if (!m) return null;
  return m[1] === '`' ? m[2].replace(/\$\{[^}]*\}/g, '*') : m[2];
}

/** Whether a guard's path is the route's own: every static segment as written, any segment where the route is dynamic. */
function namesRoute(path: string, route: string): boolean {
  const p = segs(path);
  const r = segs(route);
  return p.length === r.length && r.every((seg, i) => isDynamic(seg) || seg === p[i]);
}

describe('guard paths', () => {
  it('name the route of the file they guard', () => {
    const wrong: string[] = [];
    let guarded = 0;
    for (const file of filesNamed(['page.tsx', 'layout.tsx'])) {
      for (const arg of guardArgs(readFileSync(join(ROOT, file), 'utf8'))) {
        guarded++;
        const path = guardPath(arg);
        if (!path || !namesRoute(path, routeOf(file))) wrong.push(`${file}: ${arg}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(guarded).toBeGreaterThan(50);
  });

  it('reads a guard path the way pages write it', () => {
    expect(guardArgs("await requireRouteAccess(`/x/${encodeURIComponent(id)}`);")).toEqual(['`/x/${encodeURIComponent(id)}`']);
    expect(guardPath("'/admin/more'")).toBe('/admin/more');
    expect(guardPath('`/dashboard/clients/${id}/users`')).toBe('/dashboard/clients/*/users');
    expect(guardPath('MORE_HREF')).toBeNull();
    expect(namesRoute('/dashboard/clients/*/users', '/dashboard/clients/[id]/users')).toBe(true);
    expect(namesRoute('/admin/finalize', '/admin/finalize/[id]')).toBe(false);
    expect(namesRoute('/admin/outbox', '/admin/signatures')).toBe(false);
    expect(namesRoute('/admin/*', '/admin/outbox')).toBe(false);
    expect(namesRoute('/admin', '/admin')).toBe(true);
  });
});

/*
 * Orphan routes. Every staff page is reachable: from a sidebar entry (or under
 * one that matches its children), as a detail page under a reachable page, as
 * where the route map sends a role, or from a named file that links to it.
 */
const STAFF = ['/dashboard', '/admin', '/finance', '/liaison', '/chat', '/client-portal-preview'];

/** Pages linked from somewhere other than a sidebar: the file named must mention `mention` (default: the route itself). */
const REACHED_FROM: Record<string, { file: string; mention?: string }> = {
  '/dashboard/assistant': { file: 'components/assistant/AssistantLauncher.tsx' },
  '/dashboard/tools': { file: 'lib/nav/pages.ts' },
  '/admin/more': { file: 'lib/nav/more.ts' },
  '/finance/more': { file: 'lib/nav/more.ts' },
  '/liaison/more': { file: 'lib/nav/more.ts' },
  '/admin/detail/[entity]/[id]': { file: 'components/admin/AdminEntityPage.tsx', mention: '/admin/detail/' },
  '/finance/billing-letter': { file: 'app/finance/templates/page.tsx' },
  '/dashboard/clients/portal-previews': { file: 'app/dashboard/clients/page.tsx' },
  '/dashboard/corporations/calendar': { file: 'app/dashboard/corporations/page.tsx' },
  '/dashboard/trademarks/deadlines': { file: 'app/dashboard/trademarks/page.tsx' },
  '/dashboard/trademarks/report-wording': { file: 'app/dashboard/trademarks/page.tsx' },
  '/client-portal-preview/[clientId]': { file: 'components/PortalPreviewDirectory.tsx', mention: '/client-portal-preview/${' },
  // The global search function emits /dashboard/files/<id>.
  '/dashboard/[entity]/[id]': { file: 'supabase/migrations/00000000000001_baseline.sql', mention: "'/dashboard/files/'" },
  '/finance/clients/[name]/ledger': {
    file: 'components/finance/LedgerView.tsx', mention: '/finance/clients/${encodeURIComponent(client)}/ledger',
  },
  '/finance/clients/[name]/statement': {
    file: 'components/finance/ClientLedgerView.tsx', mention: '/finance/clients/${encodeURIComponent(clientName)}/statement',
  },
  // Hearings and Meetings are Calendar's tabs, whose rows open the hearing or meeting.
  '/dashboard/hearings/[id]': { file: 'app/dashboard/calendar/HearingsTable.tsx', mention: '/dashboard/hearings/${h.id}' },
  '/dashboard/meetings/[id]': { file: 'app/dashboard/calendar/MeetingsTable.tsx', mention: '/dashboard/meetings/${m.id}' },
};

/**
 * Staff mirrors of the client portal: each page under one is linked the way
 * the portal links its twin, through the shared views' `basePath`.
 */
const PORTAL_MIRRORS = ['/client-portal-preview/[clientId]'];

/** Pages that only redirect somewhere else, kept so old links keep working. */
const REDIRECT_STUBS: Record<string, string> = {
  '/dashboard/chat': 'Old chat entry; chat lives at /chat.',
  '/dashboard/chat/[channelId]': 'Chat message notifications still link here.',
};

/** Pages nothing links to today, kept on purpose. */
const UNLINKED: Record<string, string> = {
};

/** Pages kept but taken out of the sidebars on purpose. */
const HIDDEN: Record<string, string> = {};

const isDynamic = (s: string) => s.startsWith('[');
const segs = (p: string) => p.split('/').filter(Boolean);

/** The page route Next serves `href` from: static segments beat dynamic ones, left to right. */
function resolveHref(href: string): string | null {
  const parts = segs(href.split('?')[0]);
  let best: { route: string; score: string } | null = null;
  for (const route of ROUTES.keys()) {
    const r = segs(route);
    const catchAll = r.length > 0 && /^\[\[?\.\.\./.test(r[r.length - 1]);
    if (catchAll ? parts.length < r.length - 1 : parts.length !== r.length) continue;
    let score = '';
    let fits = true;
    for (let i = 0; i < r.length; i++) {
      if (isDynamic(r[i])) score += '0';
      else if (r[i] === parts[i]) score += '1';
      else { fits = false; break; }
    }
    if (fits && (!best || score > best.score)) best = { route, score };
  }
  return best?.route ?? null;
}

const NAV_ROUTES = new Set(ALL_PAGES.map((p) => resolveHref(p.href)).filter((r): r is string => !!r));
const PREFIXES = ALL_PAGES.filter((p) => p.matchPrefix).map((p) => p.href);
const REWRITE_TARGETS = new Set(
  ROUTE_ACCESS.flatMap((r) => Object.values(r.rewrite ?? {})).map((t) => resolveHref(t!.replace(/\*/g, 'x'))),
);

/** A route with its parameter names dropped, so /portal/matters/[id] and …/matters/[mid] compare equal. */
const shape = (route: string) => route.replace(/\[[^\]]*\]/g, '[]');
const PORTAL_ROUTES = new Set([...ROUTES.keys()].filter((r) => r.startsWith('/portal/')).map(shape));

function reached(route: string, seen = new Set<string>()): boolean {
  if (seen.has(route)) return false;
  seen.add(route);
  if (NAV_ROUTES.has(route) || REACHED_FROM[route] || REWRITE_TARGETS.has(route)) return true;
  if (PREFIXES.some((p) => route.startsWith(`${p}/`))) return true;
  const mirror = PORTAL_MIRRORS.find((m) => route.startsWith(`${m}/`));
  if (mirror && reached(mirror, seen) && PORTAL_ROUTES.has(shape(`/portal${route.slice(mirror.length)}`))) return true;
  const parts = segs(route);
  const last = parts.map(isDynamic).lastIndexOf(true);
  const parent = `/${parts.slice(0, last).join('/')}`;
  return last > 0 && ROUTES.has(parent) && reached(parent, seen);
}

const staffRoutes = [...ROUTES.keys()].filter((r) => STAFF.some((s) => r === s || r.startsWith(`${s}/`)));

describe('staff routes', () => {
  it('are all reachable', () => {
    const orphans = staffRoutes.filter((r) => !REDIRECT_STUBS[r] && !UNLINKED[r] && !HIDDEN[r] && !reached(r));
    expect(orphans).toEqual([]);
  });

  it('are linked from the files the list names', () => {
    for (const [route, { file, mention }] of Object.entries(REACHED_FROM)) {
      expect(ROUTES.has(route), route).toBe(true);
      expect(readFileSync(join(ROOT, file), 'utf8'), `${file} → ${route}`).toContain(mention ?? route);
    }
  });

  it('list redirect stubs that redirect, and only pages that exist', () => {
    for (const route of Object.keys(REDIRECT_STUBS)) {
      const file = ROUTES.get(route);
      expect(file, route).toBeDefined();
      expect(readFileSync(join(ROOT, file!), 'utf8'), route).toMatch(/\b(permanentRedirect|redirect)\(/);
    }
    for (const route of Object.keys(UNLINKED)) expect(ROUTES.has(route), route).toBe(true);
  });

  it('keep hidden pages out of every sidebar', () => {
    for (const route of Object.keys(HIDDEN)) {
      expect(ROUTES.has(route), route).toBe(true);
      expect(NAV_ROUTES.has(route), route).toBe(false);
    }
  });

  it('resolve sidebar hrefs to the page Next serves', () => {
    expect(resolveHref('/admin/clients')).toBe('/admin/[entity]');
    expect(resolveHref('/admin/users')).toBe('/admin/users');
    expect(resolveHref('/dashboard/prospects/proposals')).toBe('/dashboard/prospects/proposals');
    expect(resolveHref('/dashboard/deliverables/abc')).toBe('/dashboard/deliverables/[id]');
  });
});

/*
 * Page titles. A sidebar page's browser tab says what its sidebar entry says:
 * the page's static `metadata.title`, or for the admin database tables the
 * entity's plural label, which their generateMetadata returns.
 */
function staticTitle(src: string): string | null {
  return /export const metadata(?::\s*Metadata)?\s*=\s*\{[^}]*?\btitle:\s*(['"])(.*?)\1/.exec(src)?.[2] ?? null;
}

describe('sidebar page titles', () => {
  it('match the sidebar label', () => {
    const mismatches: string[] = [];
    for (const page of ALL_PAGES) {
      // A view of a page (`?view=`) shares that page's title.
      if (page.href.includes('?')) continue;
      const route = resolveHref(page.href);
      if (!route) { mismatches.push(`${page.href}: no page`); continue; }
      const title = route === '/admin/[entity]'
        ? ENTITY_CONFIGS[segs(page.href)[1]]?.labelPlural ?? null
        : staticTitle(readFileSync(join(ROOT, ROUTES.get(route)!), 'utf8'));
      if (title !== page.label) mismatches.push(`${page.href}: '${title ?? 'no static title'}' vs '${page.label}'`);
    }
    expect(mismatches).toEqual([]);
  });

  it('reads a static title the way pages write it', () => {
    expect(staticTitle("export const metadata: Metadata = { title: 'Review & Generate' };")).toBe('Review & Generate');
    expect(staticTitle('export const metadata = {\n  title: "Books",\n};')).toBe('Books');
    expect(staticTitle('export async function generateMetadata() { return { title: x }; }')).toBeNull();
  });
});
