import { redirect } from 'next/navigation';
import { getSession, type Session } from '@/lib/session';
import { canOpenWithin, homeFor, refusedDestination } from './access';

/**
 * The signed-in session, for a page the route map gates: anyone signed out
 * goes to /login, and a role the map refuses `pathname` goes where it says.
 */
export async function requireRouteAccess(pathname: string): Promise<Session> {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  const dest = refusedDestination(session.user.role, pathname);
  if (dest) redirect(dest);
  return session;
}

/**
 * The same for an area's layout, which can't see the path below it: refuses
 * only a role that may open nothing under `prefix`. The proxy and the page
 * guards handle the rest.
 */
export async function requireAreaAccess(prefix: string): Promise<Session> {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  if (!canOpenWithin(session.user.role, prefix)) redirect(homeFor(session.user.role));
  return session;
}
