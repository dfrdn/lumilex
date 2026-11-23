import './load-env';
import './probe-websocket';
import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { probeFetch } from './probe-fetch';

/**
 * The public demo's guards, through the real handlers:
 *
 *   npx tsx scripts/demo-probe.ts        # needs a dev server with LUMILEX_INSTANCE_ROLE=demo
 *
 * The one-click sign-in must hand out a registered persona on the demo host
 * and nothing anywhere else; a signed-in persona must be refused everything
 * lib/demo/guard.ts refuses and still allowed ordinary work. Every refusal is
 * paired with a control that must succeed, so a broken session — which would
 * refuse everything — cannot pass as security.
 *
 * Requests go to `demo.localhost` (the demo firm's local domain, added by
 * scripts/demo/build.ts) or `localhost` (the dev firm), on the port of
 * PROBE_BASE_URL (default http://localhost:3000). Addressed by URL, not by an
 * overridden Host header: fetch drops that header, and a probe whose requests
 * all silently arrive as localhost passes every refusal for the wrong reason.
 * It needs the demo firm built; it changes nothing it does not put back.
 *
 * Deliberately not driven here: set-password's own-firm check. The only other
 * firm with staff on this project is the dev firm, whose login is a real
 * person's, and a deny attempt that would have worked would reset it.
 */

const BASE = process.env.PROBE_BASE_URL ?? 'http://localhost:3000';
const DEMO_HOST = 'demo.localhost';
const OTHER_HOST = 'localhost';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail = ''): void {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : ` — ${detail}`}`);
}

async function request(
  path: string,
  { host, cookie, method = 'GET', body }: { host: string; cookie?: string; method?: string; body?: unknown },
): Promise<Response> {
  const url = new URL(path, BASE);
  url.hostname = host;
  return probeFetch(url.toString(), {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function authCookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => /^sb-.*-auth-token/.test(c) && !c.endsWith('='))
    .join('; ');
}

/** Probe requests are recorded like a visitor's; they are deleted at the end of the run. */
const PROBE_EMAIL = `probe-${Date.now()}@lumilex.example`;

/** Asks for access through the form, as a visitor does, and signs in as `as`. */
async function signIn(host: string, as: string): Promise<{ res: Response; cookie: string; access: string }> {
  const url = new URL('/api/auth/demo', BASE);
  url.hostname = host;
  const res = await probeFetch(url.toString(), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Demo Probe', email: PROBE_EMAIL, position: 'Probe', as }).toString(),
  });
  const access = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('lumilex_demo_access=')) ?? '';
  return { res, cookie: authCookies(res), access };
}

function location(res: Response): string {
  return new URL(res.headers.get('location') ?? '', BASE).pathname;
}

async function refusedInDemo(name: string, res: Response): Promise<void> {
  const text = await res.text();
  record(name, res.status === 403 && /isn’t available in the demo/.test(text), `${res.status} ${text.slice(0, 120)}`);
}

async function main() {
  const service = getSupabase();
  const { data: firm } = await service.from('firms').select('id, settings').eq('slug', 'demo').maybeSingle();
  if (!firm) throw new Error('No demo firm — run scripts/demo/build.ts first.');
  const db = getServiceDbForFirm(firm.id);

  console.log('── the one-click sign-in ──');
  const off = await signIn(OTHER_HOST, 'partner');
  record('refused on a host that is not the demo firm’s', location(off.res) === '/login' && !off.cookie,
    `${off.res.status} → ${location(off.res)}`);
  for (const as of ['super_user', 'lawyer-but-not-a-role', 'person-id']) {
    const r = await signIn(DEMO_HOST, as);
    record(`refused for ?as=${as}`, location(r.res) === '/login' && !r.cookie, `${r.res.status} → ${location(r.res)}`);
  }
  const partner = await signIn(DEMO_HOST, 'partner');
  record('control: the partner persona signs in and lands on /', location(partner.res) === '/' && !!partner.cookie,
    `${partner.res.status} → ${location(partner.res)}`);
  const admin = await signIn(DEMO_HOST, 'admin');
  record('control: the admin persona signs in', !!admin.cookie, `${admin.res.status}`);

  console.log('── access requires the request ──');
  const bare = await request('/api/auth/demo?as=partner', { host: DEMO_HOST });
  record('the one-click link without an access cookie lands on the form', location(bare) === '/login' && !authCookies(bare),
    `${bare.status} → ${location(bare)}`);
  const forged = await request('/api/auth/demo?as=partner', { host: DEMO_HOST, cookie: 'lumilex_demo_access=3f2b7c1e-8d4a-4c6b-9e2f-1a2b3c4d5e6f' });
  record('a forged access cookie is refused', location(forged) === '/login' && !authCookies(forged), `${forged.status}`);
  const incomplete = await request('/api/auth/demo', { host: DEMO_HOST, method: 'POST' });
  record('an empty request is refused', location(incomplete) === '/login' && !authCookies(incomplete), `${incomplete.status}`);
  const switched = await request('/api/auth/demo?as=finance', { host: DEMO_HOST, cookie: partner.access });
  record('control: with the access cookie the one-click switch signs in', location(switched) === '/' && !!authCookies(switched),
    `${switched.status} → ${location(switched)}`);
  if (!partner.cookie || !admin.cookie) {
    console.log('\nNo persona session — the rest of the probe cannot run. Is the server in demo mode?');
    process.exit(1);
  }
  const P = { host: DEMO_HOST, cookie: partner.cookie };
  const A = { host: DEMO_HOST, cookie: admin.cookie };

  console.log('── ordinary work is allowed ──');
  const profile = await request('/api/user/profile', P);
  const me = (await profile.json().catch(() => ({}))) as { nickname?: string; email?: string };
  record('control: the persona reads its own profile', profile.status === 200, `${profile.status}`);
  const patched = await request('/api/user/profile', { ...P, method: 'PATCH', body: { nickname: 'Probe' } });
  record('control: the persona edits its own nickname', patched.status === 200, `${patched.status}`);
  await request('/api/user/profile', { ...P, method: 'PATCH', body: { nickname: me.nickname ?? '' } });

  console.log('── what the demo refuses ──');
  await refusedInDemo('changing the persona’s password', await request('/api/user/change-password', {
    ...P, method: 'POST', body: { currentPassword: 'x-Probe-1234', newPassword: 'y-Probe-1234', confirmPassword: 'y-Probe-1234' },
  }));
  await refusedInDemo('setting a colleague’s password', await request('/api/auth/set-password', {
    ...P, method: 'POST', body: { email: me.email, password: 'Probe-Password-1234' },
  }));
  await refusedInDemo('editing a rule set', await request('/api/partner/rules', {
    ...P, method: 'POST', body: { name: 'Probe rule set', triggerEventLabel: 'Receipt of order', applicableMatterTypes: ['Litigation'], deadlines: [] },
  }));
  const { data: client } = await db.from('clients').select('notion_id').limit(1).maybeSingle();
  await refusedInDemo('inviting a portal user', await request(`/api/clients/${client?.notion_id ?? 'none'}/users`, {
    ...P, method: 'POST', body: { email: 'probe@client.example', name: 'Probe Client' },
  }));
  await refusedInDemo('writing a global table through the admin tables', await request('/api/admin/ph_holidays', {
    ...A, method: 'POST', body: { row: { name: 'Probe Day', date: '2099-01-01' } },
  }));

  await service.from('demo_access_requests').delete().eq('email', PROBE_EMAIL);

  const failures = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failures.length}/${results.length} checks pass`);
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
