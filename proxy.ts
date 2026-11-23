import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { homeFor, refusedDestination } from '@/lib/nav/access';

// Host → firm mapping memo. firm_domains changes are operator-rare; a short
// TTL keeps the per-request cost at zero without a staleness footgun.
const HOST_TTL_MS = 60_000;
const hostFirmMemo = new Map<string, { firmId: string | null; primaryDomain: string | null; at: number }>();

async function resolveHostFirm(
  service: SupabaseClient,
  host: string | null,
): Promise<{ firmId: string | null; primaryDomain: string | null }> {
  if (!host) return { firmId: null, primaryDomain: null };
  const domain = host.toLowerCase().split(':')[0];
  const hit = hostFirmMemo.get(domain);
  if (hit && Date.now() - hit.at < HOST_TTL_MS) return hit;

  const { data } = await service
    .from('firm_domains')
    .select('firm_id, is_primary')
    .eq('domain', domain)
    .maybeSingle();

  let primaryDomain: string | null = null;
  if (data) {
    const { data: primary } = await service
      .from('firm_domains')
      .select('domain')
      .eq('firm_id', data.firm_id)
      .eq('is_primary', true)
      .maybeSingle();
    primaryDomain = primary?.domain ?? null;
  }

  const entry = { firmId: (data?.firm_id as string) ?? null, primaryDomain, at: Date.now() };
  hostFirmMemo.set(domain, entry);
  return entry;
}

// Portal-flag memo. Same rationale and TTL as the host memo above: this runs
// on every portal request and an operator flipping the flag is rare.
const portalFlagMemo = new Map<string, { enabled: boolean; at: number }>();

/**
 * Is the client portal on for this firm?
 *
 * lib/firm/features.ts is the authority on the guard matrix, but the proxy runs
 * on the edge runtime and that module reaches node:crypto and web-push through
 * its credential and platform predicates. `portal` is the one feature with no
 * platform env and no bring-your-own credentials, so its guard is exactly the
 * two conditions below and this cannot drift into a weaker rule. Adding a
 * third level to `portal` means giving the proxy a different mechanism, not
 * quietly extending this function.
 */
async function portalEnabled(service: SupabaseClient, firmId: string): Promise<boolean> {
  const hit = portalFlagMemo.get(firmId);
  if (hit && Date.now() - hit.at < HOST_TTL_MS) return hit.enabled;

  const [firm, integration] = await Promise.all([
    service.from('firms').select('settings').eq('id', firmId).maybeSingle(),
    service
      .from('firm_integrations')
      .select('enabled')
      .eq('firm_id', firmId)
      .eq('feature', 'portal')
      .maybeSingle(),
  ]);

  const entitled = (firm.data?.settings as { features?: Record<string, boolean> } | null)
    ?.features?.portal === true;
  const enabled = entitled && integration.data?.enabled === true;
  portalFlagMemo.set(firmId, { enabled, at: Date.now() });
  return enabled;
}

/**
 * Is this auth user a platform operator? The one query the /platform branch
 * runs, and the whole authorization decision for that surface.
 *
 * `platform_operators` is a global table with deny-by-default RLS, so the
 * service-role client is the only reader; `active` is part of the query rather
 * than a field the caller inspects, so a deactivated operator is
 * indistinguishable from someone who never was one.
 */
async function isPlatformOperator(service: SupabaseClient, authUserId: string): Promise<boolean> {
  const { data } = await service
    .from('platform_operators')
    .select('auth_user_id')
    .eq('auth_user_id', authUserId)
    .eq('active', true)
    .maybeSingle();
  return !!data;
}

/**
 * The platform's own origin, from APP_BASE_URL.
 *
 * Note this module runs on the edge runtime, so it reads the env directly
 * rather than importing lib/app-url.ts's `appBaseUrl()` — same reasoning as
 * the `portalEnabled` comment above, keeping the edge bundle free of anything
 * that could pull in node:crypto. The value is required at boot (lib/env.ts);
 * null here means a deployment misconfigured badly enough that the operator
 * surface should be closed, not opened on every host.
 */
function platformOrigin(): URL | null {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPortalRoute = pathname.startsWith('/portal') || pathname.startsWith('/api/portal');
  const isPlatformRoute = pathname.startsWith('/platform') || pathname.startsWith('/api/platform');

  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // @supabase/ssr refreshes expired access tokens inside `getClaims()` and
  // writes the new cookies via the `setAll` callback above (which reassigns
  // `response`). Any reply we return must carry those cookies, or the client
  // keeps replaying its stale token and we loop right back here. Redirects
  // created via NextResponse.redirect(...) start fresh, so we have to copy
  // the refreshed cookies onto them explicitly.
  function redirect(url: URL): NextResponse {
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  }

  // Access tokens are signed with ES256, so getClaims() verifies the signature
  // locally against the cached JWKS instead of calling GoTrue on every
  // request. It still refreshes an expiring token first, writing the new
  // cookies through `setAll` above.
  //
  // Trade-off: a session revoked server-side (global sign-out, admin revoke)
  // passes this check until its access token expires. Pages and route
  // handlers still call getSession(), which asks GoTrue via getUser() and
  // rejects it at once, and deactivating a team or client user
  // (`active = false`) still takes effect here immediately.
  const { data: verified } = await supabase.auth.getClaims();
  const authUserId = verified?.claims.sub;

  if (!authUserId) {
    // The query rides along: on the public demo, `/?as=partner` is a link from
    // the marketing site, and the login page is what acts on it.
    const loginUrl = new URL(
      `${isPortalRoute ? '/portal/login' : '/login'}${req.nextUrl.search}`,
      req.url,
    );
    return redirect(loginUrl);
  }

  const service = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // ── /platform — the operator surface ───────────────────────────────
  //
  // Resolved here, ahead of the team and portal lookups, and it returns
  // without falling through to any of them. Two things follow from that
  // ordering. Ordinary firm traffic never pays for a platform_operators read
  // — the query below runs only on /platform paths. And an operator never
  // pays for the team/portal reads or, more importantly, for the whitelabel
  // host binding further down: a person who is both an operator and some
  // firm's staff would otherwise be bounced off the platform host onto that
  // firm's domain, which is the one place their staff identity must not
  // follow them.
  //
  // A non-operator is redirected, never refused. A 403 page would confirm the
  // surface exists to anyone who guessed the path. /dashboard is the neutral
  // destination: everyone reaching this line is signed in as *something*
  // (unauthenticated traffic was bounced above), so the ordinary pipeline
  // sorts them out on the next request — staff land on their dashboard, a
  // portal client is forwarded to /portal. That is one extra round trip on a
  // path no legitimate user takes, in exchange for a branch that does exactly
  // one lookup and reveals nothing.
  if (isPlatformRoute) {
    if (!(await isPlatformOperator(service, authUserId))) {
      return redirect(new URL('/dashboard', req.url));
    }

    // The operator surface answers on the platform's own host only. A tenant
    // host is that firm's front door: serving /platform there would render the
    // cross-tenant surface under the firm's branding and advertise its
    // existence on their domain. An operator who arrives on the wrong host is
    // sent to the right one (they will re-authenticate there — auth cookies
    // are per-host by design, and that is correct: the operator session should
    // not exist on a tenant's origin at all).
    const origin = platformOrigin();
    if (!origin) {
      console.error('[proxy] APP_BASE_URL missing or unparseable — /platform closed');
      return redirect(new URL('/login', req.url));
    }
    const requestHost = (req.headers.get('host') ?? '').toLowerCase().split(':')[0];
    if (requestHost !== origin.hostname.toLowerCase()) {
      return redirect(new URL(`${pathname}${req.nextUrl.search}`, origin));
    }

    return response;
  }

  const teamRes = await service
    .from('team')
    .select('role, firm_id')
    .eq('auth_user_id', authUserId)
    .eq('active', true)
    .single();

  const isTeam = !!teamRes.data;

  // A firm without the portal has no portal routes and pays for no portal
  // lookup: the flag is checked before the client_users query, not after.
  const teamFirmId = (teamRes.data?.firm_id as string) ?? null;
  if (isPortalRoute && isTeam && teamFirmId && !(await portalEnabled(service, teamFirmId))) {
    return redirect(new URL('/dashboard', req.url));
  }

  // The portal lookup only matters on portal routes or when the auth user has
  // no team row — staff requests skip the second query entirely.
  let clientFirmId: string | null = null;
  let isClient = false;
  if (isPortalRoute || !isTeam) {
    const clientRes = await service
      .from('client_users')
      .select('client_id, firm_id')
      .eq('auth_user_id', authUserId)
      .eq('active', true)
      .single();
    isClient = !!clientRes.data;
    clientFirmId = (clientRes.data?.firm_id as string) ?? null;
  }

  // A portal user whose firm has turned the portal off has nowhere to be.
  if (isPortalRoute && isClient && clientFirmId && !(await portalEnabled(service, clientFirmId))) {
    return redirect(new URL('/portal/login', req.url));
  }

  if (isTeam && isClient) {
    console.error('[proxy] auth_user_id present in both team and client_users:', authUserId);
  }

  // Whitelabel host binding: when the request host maps to a firm and the
  // session belongs to a different firm, bounce to the session firm's primary
  // domain — or, when it has none, to the platform's own origin. Staying put
  // is not an option: whitelabel branding is resolved from the host, so this
  // user would be shown another tenant's name and mark on that tenant's
  // domain. The platform origin is the same fallback firmBaseUrl() uses for a
  // firm with no primary domain. No-op on unmapped hosts.
  const sessionFirmId = teamFirmId ?? clientFirmId;
  const hostFirm = await resolveHostFirm(service, req.headers.get('host'));
  if (hostFirm.firmId && sessionFirmId && hostFirm.firmId !== sessionFirmId) {
    const { data: ownPrimary } = await service
      .from('firm_domains')
      .select('domain')
      .eq('firm_id', sessionFirmId)
      .eq('is_primary', true)
      .maybeSingle();
    if (ownPrimary?.domain) {
      // Carry the query across with the path: this bounce is the whole
      // response to a link someone followed, so dropping the search string
      // silently discards the filter, page or token that link was for. Same
      // shape as the /platform host redirect above.
      const dest = new URL(
        `${req.nextUrl.pathname}${req.nextUrl.search}`,
        `https://${ownPrimary.domain}`,
      );
      return redirect(dest);
    }

    // No host of their own. Fall back to the platform origin rather than
    // serving them under the other firm's branding. Guarded against a loop
    // for the case where the platform's own hostname is itself mapped to a
    // firm in firm_domains — there, redirecting would land right back here.
    const origin = platformOrigin();
    const requestHost = (req.headers.get('host') ?? '').toLowerCase().split(':')[0];
    if (origin && requestHost !== origin.hostname.toLowerCase()) {
      return redirect(new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, origin));
    }
  }

  if (isPortalRoute) {
    if (!isClient) {
      return redirect(new URL(isTeam ? '/dashboard' : '/login', req.url));
    }
    return response;
  }

  if (isClient && !isTeam) {
    return redirect(new URL('/portal', req.url));
  }

  if (!isTeam) {
    // An auth user who is neither staff nor a portal client may still be a
    // platform operator — /login is where LoginForm's post-sign-in bounce to
    // '/' would otherwise strand them, signing in in a circle against a
    // session that is already valid. Only this path pays for the lookup, and
    // it already ended in a redirect.
    const origin = platformOrigin();
    if (origin && (await isPlatformOperator(service, authUserId))) {
      return redirect(new URL('/platform', origin));
    }
    return redirect(new URL('/login', req.url));
  }

  const role = (teamRes.data?.role as string) ?? 'lawyer';

  if (pathname === '/') return redirect(new URL(homeFor(role), req.url));

  // Who may open which staff page is one map (lib/nav/access.ts), read here,
  // by the area layouts, by every page's guard and by the sidebars.
  const refusedTo = refusedDestination(role, pathname);
  if (refusedTo) {
    const dest = new URL(refusedTo, req.url);
    // A rewrite opens the same thing elsewhere, so it keeps the query.
    if (refusedTo !== homeFor(role)) dest.search = req.nextUrl.search;
    return redirect(dest);
  }

  // Nothing to preview when the firm has no portal.
  if (pathname.startsWith('/client-portal-preview') && teamFirmId && !(await portalEnabled(service, teamFirmId))) {
    return redirect(new URL('/dashboard', req.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!login|portal/login|portal/auth|intake|api/public|api/auth|api/dev|api/members|api/admin|api/notifications/email-briefer|api/notifications/generate|api/embeddings|api/file-analysis|api/matter-summary|api/deliverable-analyze|api/matter-health|api/sla/evaluate|api/matters/auto-archive|api/cron|api/issuances/scrape-batch|api/me|api/chat|api/calendar|api/preview|api/push|api/people|api/entity-detail|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.svg|.*\\.ico|.*\\.jpg|.*\\.jpeg|.*\\.webp).*)'],
};
