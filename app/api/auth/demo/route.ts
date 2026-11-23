import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { findFirmIdByHost, getFirmConfig } from '@/lib/firm/config';
import { demoMemberUsable, resolveDemoPersona } from '@/lib/demo/sign-in';
import { isDemoDeployment } from '@/lib/demo/guard';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIP } from '@/lib/audit';
import { DEMO_ACCESS_COOKIE, DEMO_ACCESS_MAX_AGE, parseDemoAccessRequest } from '@/lib/demo/access';
import { hasDemoAccess, recordDemoAccessRequest } from '@/lib/demo/access-store';

/**
 * The public demo's sign-in. A visitor first asks for access — POST with a
 * name, work email, position and role, from lumilex.co/demo or the demo's own
 * login page — which records a `demo_access_requests` row, hands back its id
 * as a cookie and signs them in. After that, GET /api/auth/demo?as=partner is
 * the one-click switch between roles, and it requires that cookie: without
 * one the visitor lands on the login page, which asks for the details.
 *
 * Unauthenticated by construction — it is how a visitor becomes a caller — and
 * excluded from the proxy with the rest of `api/auth`. The three conditions it
 * holds are in lib/demo/sign-in.ts; every refusal lands on the same plain
 * login page, so a probe learns nothing about which condition failed.
 *
 * The session is minted the way the dev impersonation route does it: an admin
 * magic-link token verified server-side. No password exists for a persona, so
 * there is none to publish, share or change.
 */

const LIMIT = { limit: 30, windowSeconds: 15 * 60 };
/** Requests are rarer than role switches; this caps a form-filling bot but leaves room for an office behind one address. */
const REQUEST_LIMIT = { limit: 20, windowSeconds: 60 * 60 };

/**
 * A path on the host the visitor asked for. Built from the Host header rather
 * than `req.url`, which a dev server reports as localhost whatever host the
 * request arrived on — and the session cookie belongs to that host, so a
 * redirect anywhere else lands signed out.
 */
function onSameHost(req: NextRequest, path: string): URL {
  const host = req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(/:$/, '');
  return new URL(path, host ? `${proto}://${host}` : req.url);
}

function toLogin(req: NextRequest, query = ''): NextResponse {
  // 303 so a refused POST comes back to the login page as a GET.
  return NextResponse.redirect(onSameHost(req, `/login${query}`), 303);
}

function tooMany(): NextResponse {
  return new NextResponse('Too many sign-ins from this address. Try again in a few minutes.', { status: 429 });
}

export async function GET(req: NextRequest) {
  const as = req.nextUrl.searchParams.get('as');
  if (!checkRateLimit(`demo-sign-in:${getClientIP(req)}`, LIMIT).allowed) return tooMany();
  if (!(await hasDemoAccess(req.cookies.get(DEMO_ACCESS_COOKIE)?.value))) {
    return toLogin(req, typeof as === 'string' ? `?as=${encodeURIComponent(as)}` : '');
  }
  return signIn(req, as);
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  if (!checkRateLimit(`demo-request:${ip}`, REQUEST_LIMIT).allowed) return tooMany();

  const form = await req.formData().catch(() => null);
  const parsed = parseDemoAccessRequest(form ? Object.fromEntries(form) : {});
  const as = form?.get('as');
  if (!parsed.ok) {
    const back = new URLSearchParams({ invalid: parsed.fields.join(',') });
    if (typeof as === 'string') back.set('as', as);
    return toLogin(req, `?${back}`);
  }
  // Only on a demo deployment: anywhere else this table must stay empty.
  if (!isDemoDeployment()) return toLogin(req);

  const persona = parsed.request.as;
  const id = await recordDemoAccessRequest(parsed.request, req.headers.get('referer'));
  if (!id) return toLogin(req, `?as=${persona}`);

  const res = await signIn(req, persona);
  res.cookies.set(DEMO_ACCESS_COOKIE, id, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: DEMO_ACCESS_MAX_AGE,
  });
  return res;
}

async function signIn(req: NextRequest, as: string | null): Promise<NextResponse> {
  const host = req.headers.get('host');
  const firmId = host ? await findFirmIdByHost(host) : null;
  const firm = firmId ? await getFirmConfig(firmId) : null;

  const persona = resolveDemoPersona({
    deploymentIsDemo: isDemoDeployment(),
    demo: firm?.demo ?? null,
    as,
  });
  if (!persona.ok || !firmId) {
    console.warn(`[demo-sign-in] refused (${persona.ok ? 'no_firm' : persona.reason}) on ${host}`);
    return toLogin(req);
  }

  const { data: row } = await getServiceDbForFirm(firmId)
    .from('team')
    .select('person_id, firm_id, role, active, auth_user_id, email')
    .eq('person_id', persona.personId)
    .maybeSingle();

  const member = row
    ? {
        personId: row.person_id as string,
        firmId: row.firm_id as string,
        role: row.role as string,
        active: row.active === true,
        authUserId: (row.auth_user_id as string | null) ?? null,
      }
    : null;
  if (!demoMemberUsable(member, { firmId, personId: persona.personId }) || !row?.email) {
    console.warn(`[demo-sign-in] refused (persona_unavailable: ${as}) on ${host}`);
    return toLogin(req);
  }

  const { data: link, error: linkError } = await getSupabase().auth.admin.generateLink({
    type: 'magiclink',
    email: row.email as string,
  });
  if (linkError || !link?.properties?.hashed_token) {
    console.error('[demo-sign-in] generateLink failed:', linkError?.message);
    return toLogin(req);
  }

  const auth = await getSupabaseServerAuthClient();
  const { error: verifyError } = await auth.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyError) {
    console.error('[demo-sign-in] verifyOtp failed:', verifyError.message);
    return toLogin(req);
  }

  // The proxy sends '/' to the role's own landing page.
  return NextResponse.redirect(onSameHost(req, '/'), 303);
}
