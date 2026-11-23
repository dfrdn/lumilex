/**
 * The platform's own base URL, for absolute links in outbound email and push.
 *
 * This is a platform value, not a firm value: it is where the deployment lives.
 * It used to fall back to one firm's production hostname, which meant an unset
 * env sent every tenant's clients to that firm's front door. There is no
 * default that can be right for a second tenant, so there is no default.
 */
export function appBaseUrl(): string {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) {
    throw new Error(
      'APP_BASE_URL is not set — outbound links have no platform base URL and must not guess one.',
    );
  }
  return raw.replace(/\/+$/, '');
}

/**
 * Same value, for best-effort callers (push icons) that would rather ship
 * without the extra than fail the whole delivery over a missing env.
 */
export function appBaseUrlOrNull(): string | null {
  const raw = process.env.APP_BASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

/** Absolutise an in-app path against {@link appBaseUrl}. Passes URLs through. */
export function absoluteAppUrl(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `${appBaseUrl()}${href.startsWith('/') ? '' : '/'}${href}`;
}
