import type { UserRole } from '@/lib/queries/team';
import { canOpen, homeFor } from './access';
import { areaForPath } from './pages';
import type { NavArea } from './types';

export const ROLE_LABELS: Record<UserRole, string> = {
  lawyer: 'Lawyer',
  partner: 'Partner',
  admin: 'Admin',
  finance: 'Finance',
  super_user: 'Super User',
  chief_liaison_officer: 'Chief Liaison Officer',
  liaison_officer: 'Liaison Officer',
};

export const AREA_LABELS: Record<NavArea, string> = {
  dashboard: 'Dashboard',
  admin: 'Admin',
  finance: 'Finance',
  liaison: 'Liaison',
};

/** Personal settings as each shell opens them: liaisons keep theirs inside the liaison shell. */
export function settingsHref(area: NavArea): string {
  return area === 'liaison' ? '/liaison/settings' : '/dashboard/settings';
}

export interface ShellLink {
  href: string;
  label: string;
  area: NavArea;
}

/**
 * The other shells a role can jump to from `area`: its home when that lives in
 * another shell, and the team dashboard when the role may open it.
 */
export function shellLinks(role: UserRole, area: NavArea): ShellLink[] {
  const links: ShellLink[] = [];
  const home = homeFor(role);
  const homeArea = areaForPath(home);
  if (homeArea !== area) links.push({ href: home, label: `Go to ${AREA_LABELS[homeArea]}`, area: homeArea });
  if (area !== 'dashboard' && homeArea !== 'dashboard' && canOpen(role, '/dashboard')) {
    links.push({ href: '/dashboard', label: `Go to ${AREA_LABELS.dashboard}`, area: 'dashboard' });
  }
  return links;
}
