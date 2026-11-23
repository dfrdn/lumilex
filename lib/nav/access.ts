import type { UserRole } from '@/lib/queries/team';

/*
 * Who may open which staff page: the one map proxy.ts, the area layouts, the
 * page guards (lib/nav/guard.ts) and the sidebars (pagesForRole) all read.
 * Public, portal and operator paths (/login, /portal, /intake, /platform,
 * /api, …) are not in it; the proxy treats them as it always has. A firm's
 * features close pages on top of this (each page's own check, and
 * `visiblePages` for the links), never open them.
 */

export const STAFF_ROLES: readonly UserRole[] = [
  'lawyer', 'partner', 'admin', 'finance', 'super_user', 'chief_liaison_officer', 'liaison_officer',
];

export interface RouteRule {
  /**
   * A URL prefix, matched on whole segments: '/admin' covers '/admin' and
   * '/admin/x', never '/administrator'. `*` stands for any one segment. The
   * rule with the most segments that matches decides; a literal segment beats
   * a `*` in the same place.
   */
  path: string;
  /** Who may open it. super_user passes every rule. */
  roles: readonly UserRole[];
  /**
   * Where a refused role goes instead, when the same thing lives elsewhere
   * for it. Each `*` takes the segment the rule's `*` matched, and the rest of
   * the path is kept, so deep links keep working.
   */
  rewrite?: Partial<Record<UserRole, string>>;
}

const EVERYONE = STAFF_ROLES;
const OFFICE: readonly UserRole[] = ['lawyer', 'partner', 'admin', 'finance', 'super_user'];
const PARTNERS: readonly UserRole[] = ['partner', 'super_user'];
const PIPELINE: readonly UserRole[] = ['partner', 'admin', 'super_user'];
const ADMIN_AREA: readonly UserRole[] = ['admin', 'finance', 'super_user'];
const ADMINS: readonly UserRole[] = ['admin', 'super_user'];
const FINANCE: readonly UserRole[] = ['finance', 'super_user'];
const LIAISON_AREA: readonly UserRole[] = ['chief_liaison_officer', 'liaison_officer', 'admin', 'super_user'];

const forLiaisons = (path: string) => ({ chief_liaison_officer: path, liaison_officer: path });
const forOffice = (path: string) => ({ lawyer: path, partner: path, finance: path });
const LAWYERS_MORE = { lawyer: '/dashboard/tools', partner: '/dashboard/tools' };

/*
 * Replayed against the gates this map replaced — proxy.ts's role chain, the
 * area layouts and every page's own check (lib/nav/access.test.ts holds the
 * table). It opens nothing new to any role. The one narrowing is the liaison
 * roles', who stay in their own shell: under /dashboard they open deliverable
 * links only, and the personal pages they used there send them to the liaison
 * shell's own.
 */
export const ROUTE_ACCESS: readonly RouteRule[] = [
  { path: '/dashboard', roles: OFFICE },
  { path: '/dashboard/deliverables/*', roles: EVERYONE },
  // Retired (redirects to the By status view); kept so it is not read as a deliverable id.
  { path: '/dashboard/deliverables/by-status', roles: OFFICE },
  { path: '/dashboard/settings', roles: OFFICE, rewrite: forLiaisons('/liaison/settings') },
  { path: '/dashboard/chat', roles: OFFICE, rewrite: forLiaisons('/chat') },
  { path: '/dashboard/calendar', roles: OFFICE, rewrite: forLiaisons('/liaison/calendar') },
  { path: '/dashboard/my-dtr', roles: OFFICE, rewrite: forLiaisons('/liaison/my-dtr') },
  { path: '/dashboard/my-submissions', roles: OFFICE, rewrite: forLiaisons('/liaison/my-requests') },
  { path: '/dashboard/tools', roles: OFFICE, rewrite: forLiaisons('/liaison/more') },
  { path: '/dashboard/liaison-schedule', roles: ['partner', 'admin', 'finance', 'super_user'], rewrite: { chief_liaison_officer: '/liaison/schedule' } },
  { path: '/dashboard/partner', roles: PARTNERS },
  { path: '/dashboard/prospects', roles: PIPELINE },
  { path: '/dashboard/clients/portal-previews', roles: PIPELINE },
  { path: '/dashboard/clients/*/users', roles: PIPELINE, rewrite: forOffice('/dashboard/clients/*') },

  { path: '/admin', roles: ADMIN_AREA },
  { path: '/admin/finalize', roles: ADMINS },
  { path: '/admin/integrations', roles: ADMINS },
  { path: '/admin/liaison-command', roles: ADMINS },
  { path: '/admin/portal-previews', roles: ADMINS }, // retired; kept so its redirect stays as narrow as the page was
  { path: '/admin/more', roles: ADMIN_AREA, rewrite: { ...LAWYERS_MORE, ...forLiaisons('/liaison/more') } },
  { path: '/admin/portal-users', roles: ADMINS },
  { path: '/admin/settings/enums', roles: ADMINS },
  { path: '/admin/signatures', roles: ADMINS },
  { path: '/admin/sla-rules', roles: ADMINS },
  { path: '/admin/users', roles: ['super_user'] },

  { path: '/finance', roles: FINANCE },
  { path: '/finance/more', roles: FINANCE, rewrite: { ...LAWYERS_MORE, admin: '/admin/more', ...forLiaisons('/liaison/more') } },

  { path: '/liaison', roles: ['chief_liaison_officer', 'admin', 'super_user'] },
  // Admins don't carry errands of their own.
  { path: '/liaison/my-errands', roles: ['liaison_officer', 'chief_liaison_officer', 'super_user'] },
  { path: '/liaison/calendar', roles: LIAISON_AREA, rewrite: forOffice('/dashboard/calendar') },
  { path: '/liaison/my-dtr', roles: LIAISON_AREA, rewrite: forOffice('/dashboard/my-dtr') },
  { path: '/liaison/my-requests', roles: LIAISON_AREA, rewrite: forOffice('/dashboard/my-submissions') },
  { path: '/liaison/settings', roles: LIAISON_AREA, rewrite: forOffice('/dashboard/settings') },
  { path: '/liaison/schedule', roles: ['chief_liaison_officer', 'admin', 'super_user'], rewrite: { partner: '/dashboard/liaison-schedule', finance: '/dashboard/liaison-schedule' } },
  // Each shell has its own More (lib/nav/more.ts), so it never leaves the shell.
  { path: '/liaison/more', roles: LIAISON_AREA, rewrite: { ...LAWYERS_MORE, finance: '/finance/more' } },

  { path: '/chat', roles: EVERYONE },
  // The proxy also closes it when the firm has no portal.
  { path: '/client-portal-preview', roles: PIPELINE },
];

const segments = (path: string) => path.split(/[?#]/)[0].split('/').filter(Boolean);

interface Match { rule: RouteRule; length: number; literals: number; wild: string[]; rest: string[] }

function matchRule(rule: RouteRule, parts: string[]): Match | null {
  const ruleParts = segments(rule.path);
  if (ruleParts.length > parts.length) return null;
  const wild: string[] = [];
  let literals = 0;
  for (let i = 0; i < ruleParts.length; i++) {
    if (ruleParts[i] === '*') wild.push(parts[i]);
    else if (ruleParts[i] === parts[i]) literals++;
    else return null;
  }
  return { rule, length: ruleParts.length, literals, wild, rest: parts.slice(ruleParts.length) };
}

/** The rule that decides a path, or null for a path the map doesn't cover. */
function ruleFor(pathname: string): Match | null {
  const parts = segments(pathname);
  let best: Match | null = null;
  for (const rule of ROUTE_ACCESS) {
    const m = matchRule(rule, parts);
    if (m && (!best || m.length > best.length || (m.length === best.length && m.literals > best.literals))) best = m;
  }
  return best;
}

/** A role the map doesn't know is treated as a lawyer's, as the proxy treats a missing one. */
function known(role: string | null | undefined): UserRole {
  return (STAFF_ROLES as readonly string[]).includes(role ?? '') ? (role as UserRole) : 'lawyer';
}

/** Where a role lands when it opens the app, or is refused somewhere. */
export function homeFor(role: string | null | undefined): string {
  switch (known(role)) {
    case 'admin': return '/admin';
    case 'finance': return '/finance';
    case 'chief_liaison_officer': return '/liaison';
    case 'liaison_officer': return '/liaison/my-errands';
    default: return '/dashboard';
  }
}

export function canOpen(role: string | null | undefined, pathname: string): boolean {
  const r = known(role);
  if (r === 'super_user') return true;
  const m = ruleFor(pathname);
  return !m || m.rule.roles.includes(r);
}

/**
 * Where to send a role that may not open `pathname`: the rule's rewrite for
 * it when that is a page it may open, else its home. Null when it may open it.
 */
export function refusedDestination(role: string | null | undefined, pathname: string): string | null {
  if (canOpen(role, pathname)) return null;
  const r = known(role);
  const m = ruleFor(pathname)!;
  const target = m.rule.rewrite?.[r];
  if (target) {
    let i = 0;
    const filled = segments(target).map((s) => (s === '*' ? m.wild[i++] : s));
    const dest = `/${[...filled, ...m.rest].join('/')}`;
    if (canOpen(r, dest)) return dest;
  }
  return homeFor(r);
}

/**
 * Whether a role may open anything under `prefix`: the prefix itself or a
 * rule beneath it. For a layout, which can't see the full path.
 */
export function canOpenWithin(role: string | null | undefined, prefix: string): boolean {
  if (canOpen(role, prefix)) return true;
  const base = segments(prefix);
  return ROUTE_ACCESS.some((rule) => {
    const parts = segments(rule.path);
    return parts.length > base.length
      && base.every((s, i) => parts[i] === s)
      && canOpen(role, `/${parts.map((p) => (p === '*' ? '_' : p)).join('/')}`);
  });
}
