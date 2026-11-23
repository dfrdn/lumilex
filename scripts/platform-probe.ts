import './load-env';
import './probe-websocket';
import { probeFetch } from './probe-fetch';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { mintId } from '../lib/ids';
import { FEATURE_KEYS } from '../lib/firm/feature-shape';

/**
 * Platform-operator boundary probe.
 *
 * `/platform` is the one surface in this app that is deliberately cross-tenant,
 * so it is the one place where "who is allowed in" is not answered by RLS. The
 * reads behind it are service-role by necessity; the whole boundary is
 * `platform_operators` + the guard in lib/platform/auth.ts + the branch in
 * proxy.ts. Nothing underneath would catch a mistake in any of the three,
 * which is why this probe exists and why it drives the real HTTP handlers
 * rather than the database.
 *
 * Two halves:
 *
 *   1. DATABASE — through PostgREST, the same path a browser takes. Nobody
 *      reads `platform_operators`: not anon, not a firm's super_user, not an
 *      operator (not even their own row). And an operator's *session* has no
 *      more database reach than anon has — `firms_self_select` gives them
 *      nothing, because they belong to no firm. Every bit of their reach comes
 *      from the server-side guard, which is exactly the property that makes
 *      the guard worth probing.
 *
 *   2. HANDLERS — signs each persona in against the running dev server with a
 *      cookie jar (bearer tokens do not work: proxy.ts redirects a cookieless
 *      request before any handler runs) and asserts the matrix:
 *
 *        anon                  → refused
 *        firm super_user       → refused, and redirected rather than 403'd
 *        deactivated operator  → refused
 *        operator              → ALLOWED, and sees every firm  ← the control
 *        staff-who-is-also-an-operator → ALLOWED, and their staff row is
 *                                        untouched by it
 *
 *      The allow checks are not decoration. A probe where every persona is
 *      refused passes for the wrong reason — a broken fixture refuses
 *      everyone. Needs `npm run dev`; skipped (loudly) when it isn't up, or
 *      failed instead of skipped with --require-live.
 *
 *   3. MUTATIONS — the same matrix over every `/api/platform/*` write, plus
 *      the proof that a refusal actually refused. Each deny attempt sends a
 *      **valid** body, so a missing guard would really create the firm, really
 *      rename the tenant, really reactivate the revoked operator; the
 *      post-sweep assertions then look for exactly those effects. A deny check
 *      built on a malformed body passes on the validator instead of the guard
 *      and would survive the guard being deleted.
 *
 *   4. A FIRM CREATED THROUGH THE FORM IS IMMEDIATELY USABLE — the provisioning
 *      path's own guarantees, asserted through the HTTP route rather than the
 *      script: identity, domain, the deliberately-incomplete invoice row, all
 *      integrations registered and disabled, the seed pack, and a first admin
 *      who can actually sign in.
 *
 * Usage:
 *   npx tsx scripts/platform-probe.ts
 *   npx tsx scripts/platform-probe.ts --require-live
 *   PROBE_BASE_URL=http://127.0.0.1:3000 npx tsx scripts/platform-probe.ts
 *
 * Exits 1 on any violation.
 */

const URL_ = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const BASE_URL = process.env.PROBE_BASE_URL ?? 'http://localhost:3000';
const PW = 'Platform-' + Math.random().toString(36).slice(2) + 'A1!';

// Distinct from rls-probe's `probe-*` prefix on purpose: the two probes clean
// up by prefix and must not delete each other's fixtures mid-run.
const EMAIL_PREFIX = 'platform-probe-';
const EMAILS = {
  superUser: `${EMAIL_PREFIX}super@lumilex.test`,
  operator: `${EMAIL_PREFIX}operator@lumilex.test`,
  disabled: `${EMAIL_PREFIX}disabled@lumilex.test`,
  dual: `${EMAIL_PREFIX}dual@lumilex.test`,
  /** The first admin of the firm the probe creates through the form. */
  createdAdmin: `${EMAIL_PREFIX}firmadmin@lumilex.test`,
  /** Added by the allow control on POST /api/platform/operators. */
  addedOperator: `${EMAIL_PREFIX}added@lumilex.test`,
  /** The one a denied POST would have created, if the guard were missing. */
  deniedOperator: `${EMAIL_PREFIX}denied@lumilex.test`,
};

/**
 * A and B are fixtures; C is the slug the create-firm route is driven with, and
 * D the slug a *denied* create would have produced. Both are in the teardown
 * set so a crashed run cleans up on the next one.
 */
const SLUG_A = 'platform-probe-a';
const SLUG_B = 'platform-probe-b';
const SLUG_CREATED = 'platform-probe-c';
const SLUG_DENIED = 'platform-probe-denied';
/** Everything the teardown sweeps. */
const SLUGS = [SLUG_A, SLUG_B, SLUG_CREATED, SLUG_DENIED];
/** The two that exist before the handler probe runs. */
const FIXTURE_SLUGS = [SLUG_A, SLUG_B];

const DOMAIN_A = 'platform-probe-a.lumilex.test';
/** A second host on firm A, so "set primary" and "remove" have a real target. */
const DOMAIN_A_EXTRA = 'extra.platform-probe-a.lumilex.test';
const DOMAIN_A_ADDED = 'added.platform-probe-a.lumilex.test';
const DOMAIN_A_DENIED = 'denied.platform-probe-a.lumilex.test';
const DOMAIN_CREATED = 'platform-probe-c.lumilex.test';

const service = createClient(URL_, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Result bookkeeping ─────────────────────────────────────────────

type Check = { name: string; pass: boolean; skipped?: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '✗ FAIL'}  ${name}${pass ? '' : `  — ${detail}`}`);
}

function skip(name: string, why: string) {
  checks.push({ name, pass: true, skipped: true, detail: why });
  console.log(`  SKIP  ${name}  — ${why}`);
}

// ── Fixtures ───────────────────────────────────────────────────────

type Fixtures = { A: string; B: string };
const fx: Fixtures = {} as never;

async function ensureAuthUser(email: string): Promise<string> {
  const { data: created, error } = await service.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  if (!error) return created.user.id;
  const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
  const found = list?.users.find((u) => u.email === email);
  if (!found) throw new Error(`auth user create failed for ${email}: ${error.message}`);
  await service.auth.admin.updateUserById(found.id, { password: PW });
  return found.id;
}

async function insertOrThrow(table: string, row: Record<string, unknown>) {
  const { error } = await service.from(table).insert(row);
  if (error) throw new Error(`fixture insert into ${table} failed: ${error.message}`);
}

async function addTeamMember(
  firmId: string,
  email: string,
  role: string,
): Promise<{ authUserId: string; personId: string }> {
  const authUserId = await ensureAuthUser(email);
  const personId = mintId('user');
  await insertOrThrow('team', {
    notion_id: personId,
    person_id: personId,
    name: email,
    email,
    role,
    active: true,
    auth_user_id: authUserId,
    firm_id: firmId,
  });
  return { authUserId, personId };
}

/**
 * Firm A is provisioned COMPLETE and firm B deliberately half-provisioned (no
 * domain, no invoice settings). The list's job on day one is to tell those two
 * apart, so the probe would rather find out here than in production.
 */
async function provisionFixtures(): Promise<void> {
  const ids: string[] = [];
  for (const [i, slug] of [SLUG_A, SLUG_B].entries()) {
    const { data, error } = await service
      .from('firms')
      .insert({
        slug,
        name: `Platform Probe Firm ${i === 0 ? 'A' : 'B'}`,
        short_name: i === 0 ? 'PPA' : 'PPB',
      })
      .select('id')
      .single();
    if (error) throw new Error(`firm insert failed: ${error.message}`);
    ids.push(data.id as string);
  }
  fx.A = ids[0];
  fx.B = ids[1];

  // Firm A: complete. A primary domain, a full invoice settings row, staff.
  await insertOrThrow('firm_domains', { domain: DOMAIN_A, firm_id: fx.A, is_primary: true });
  // A second, non-primary host so "make primary" and "remove" have something
  // to act on that isn't the front door — a deny check against a no-op proves
  // nothing.
  await insertOrThrow('firm_domains', {
    domain: DOMAIN_A_EXTRA,
    firm_id: fx.A,
    is_primary: false,
  });
  await insertOrThrow('firm_invoice_settings', {
    firm_id: fx.A,
    firm_address: '1 Probe Street',
    firm_tin: '000-000-000',
    bank_name: 'Probe Bank',
    bank_account_no: '1234567890',
    bank_account_name: 'Platform Probe Firm A',
    signer_name: 'Probe Signer',
    invoice_prefix: 'PPA',
  });
  await addTeamMember(fx.A, EMAILS.superUser, 'super_user');

  // The person who is BOTH: firm A staff and a platform operator. Legal, and
  // the two identities must stay separate — see lib/platform/auth.ts.
  const dual = await addTeamMember(fx.A, EMAILS.dual, 'lawyer');

  // Firm B: half-provisioned on purpose. No domain, no invoice settings, no
  // team — every flag the list is supposed to raise.

  const operatorAuthId = await ensureAuthUser(EMAILS.operator);
  await insertOrThrow('platform_operators', {
    auth_user_id: operatorAuthId,
    email: EMAILS.operator,
    name: 'Platform Probe Operator',
    active: true,
  });

  fxIds.operator = operatorAuthId;

  const disabledAuthId = await ensureAuthUser(EMAILS.disabled);
  fxIds.disabledOperator = disabledAuthId;
  await insertOrThrow('platform_operators', {
    auth_user_id: disabledAuthId,
    email: EMAILS.disabled,
    name: 'Platform Probe Deactivated',
    active: false,
  });

  await insertOrThrow('platform_operators', {
    auth_user_id: dual.authUserId,
    email: EMAILS.dual,
    name: 'Platform Probe Dual',
    active: true,
  });
}

// Children before parents. `firm_domains` and `firm_invoice_settings` are
// cleaned by the firms delete's cascade / FK, but audit_log holds a plain FK to
// firms and the operator view writes rows there, so it has to go first.
//
// The seed-pack tables are here because the probe now drives the real
// create-firm route, which runs the real seed pack. The firms delete throws if
// anything is still referencing the row, so a table missing from this list
// fails the run loudly rather than leaving a half-deleted tenant behind.
const FIXTURE_TABLES = [
  'audit_log',
  'team',
  'firm_invoice_settings',
  'firm_integrations',
  'invoice_number_counters',
  'enum_options',
  'billing_rates',
  'fee_schedules',
  'scope_templates',
  'document_templates',
  'email_templates',
  'resolution_templates',
  'firm_profiles',
];

async function teardown(): Promise<void> {
  const { data: firms } = await service.from('firms').select('id').in('slug', SLUGS);
  const firmIds = (firms ?? []).map((f) => f.id as string);
  if (firmIds.length > 0) {
    for (const table of FIXTURE_TABLES) {
      const { error } = await service.from(table).delete().in('firm_id', firmIds);
      if (error) throw new Error(`teardown of ${table} failed: ${error.message}`);
    }
    const { error } = await service.from('firms').delete().in('id', firmIds);
    if (error) {
      throw new Error(
        `teardown of firms failed (fixture table missing from FIXTURE_TABLES?): ${error.message}`,
      );
    }
  }

  // Granting operator access is audited into EVERY firm
  // (`logOperatorAuditAcrossFirms(allFirmIds())` — a new operator can read
  // every tenant), so the roster mutation below leaves rows in the REAL firms
  // on this database, not only in the fixtures. That is the intended
  // behaviour, but it means teardown has to go by actor rather than by firm,
  // or every `npm run verify` would silt up every firm's log.
  const { error: auditErr } = await service
    .from('audit_log')
    .delete()
    .eq('actor_type', 'operator')
    .like('performed_by_name', 'Platform Probe%');
  if (auditErr) throw new Error(`teardown of probe audit rows failed: ${auditErr.message}`);

  const { error: opErr } = await service
    .from('platform_operators')
    .delete()
    .like('email', `${EMAIL_PREFIX}%`);
  if (opErr) throw new Error(`teardown of platform_operators failed: ${opErr.message}`);

  const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list?.users ?? []) {
    if (u.email?.startsWith(EMAIL_PREFIX) && u.email.endsWith('@lumilex.test')) {
      await service.auth.admin.deleteUser(u.id);
    }
  }
}

// ── Part 1: database ───────────────────────────────────────────────

async function signInPostgrest(email: string): Promise<SupabaseClient> {
  const client = createClient(URL_, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function expectRows(
  name: string,
  client: SupabaseClient,
  table: string,
  filter: Record<string, string>,
  expected: number,
  columns = '*',
) {
  let q = client.from(table).select(columns);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) {
    // A hard error is also a refusal for a deny check, but never an allow.
    record(name, expected === 0, `query error: ${error.message}`);
    return;
  }
  record(
    name,
    (data?.length ?? 0) === expected,
    `expected ${expected} rows, got ${data?.length ?? 0}`,
  );
}

async function databaseProbe(): Promise<void> {
  console.log('── platform_operators is unreachable through PostgREST ──');
  const anon = createClient(URL_, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const superUser = await signInPostgrest(EMAILS.superUser);
  const operator = await signInPostgrest(EMAILS.operator);

  await expectRows('anon cannot read platform_operators', anon, 'platform_operators', {}, 0);
  await expectRows(
    "a firm's super_user cannot read platform_operators",
    superUser,
    'platform_operators',
    {},
    0,
  );
  await expectRows(
    'an operator cannot read platform_operators — not even their own row',
    operator,
    'platform_operators',
    { email: EMAILS.operator },
    0,
  );

  console.log('── an operator session carries no database reach of its own ──');
  // The operator belongs to no firm, so current_firm_id() is NULL and
  // firms_self_select matches nothing. Everything the operator can see comes
  // from the server-side guard; the browser session is as powerless as anon's.
  // If this ever goes green with rows, someone widened firms_self_select.
  await expectRows('an operator reads no firms through PostgREST', operator, 'firms', {}, 0);
  // team.monthly_salary is withheld from API roles, so `*` is refused outright —
  // which would pass this deny check for the wrong reason.
  await expectRows('an operator reads no team rows through PostgREST', operator, 'team', {}, 0, 'person_id');
  await expectRows(
    "a firm's super_user still sees only its own firm",
    superUser,
    'firms',
    { id: fx.B },
    0,
  );
}

// ── Part 2: handlers ───────────────────────────────────────────────

/**
 * The cookies `@supabase/ssr` would have written for a signed-in browser.
 * Bearer tokens do not work here: proxy.ts redirects a cookieless request to
 * /login before any handler runs, so a bearer-only probe would score a 307 as
 * a refusal and pass every deny check without reaching the guard.
 */
async function sessionCookie(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(URL_, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) jar.set(c.name, c.value);
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`handler probe sign-in failed for ${email}: ${error.message}`);
  return [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ');
}

type Reply = { status: number; location: string | null; body: string };

async function send(
  method: string,
  pathname: string,
  cookie?: string,
  body?: unknown,
): Promise<Reply> {
  const res = await probeFetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

async function get(pathname: string, cookie?: string): Promise<Reply> {
  return send('GET', pathname, cookie);
}

/** A refusal that still handed over tenant data is not a refusal. */
function leaksTenantData(reply: Reply): boolean {
  return SLUGS.some((slug) => reply.body.includes(slug));
}

function refused(reply: Reply): boolean {
  const blocked = reply.status >= 300 && reply.status < 500;
  return blocked && !leaksTenantData(reply);
}

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await probeFetch(`${BASE_URL}/login`, { redirect: 'manual' });
    return res.status < 500;
  } catch {
    return false;
  }
}

const HANDLER_CHECKS = [
  'handler control: an operator reaches /platform',
  'handler control: an operator reaches /api/platform/firms and sees every firm',
  'handler control: the list flags the half-provisioned firm and not the complete one',
  'anon cannot reach /platform',
  'anon cannot reach /api/platform/firms',
  "a firm's super_user cannot reach /platform",
  "a firm's super_user cannot reach /api/platform/firms",
  "a firm's super_user is redirected, not shown a 403 that confirms the surface",
  'a deactivated operator cannot reach /platform',
  'a deactivated operator cannot reach /api/platform/firms',
  'an operator who is also firm staff reaches /platform',
  'being a platform operator does not change that person’s team row',
  'opening a firm lands in that firm’s own audit log as actor_type=operator',
];

// ── Part 3: the mutations ──────────────────────────────────────────

/**
 * A valid provisioning config, so a denied POST would really have created a
 * firm. A deny check whose body the validator rejects first would still pass
 * with the guard deleted.
 */
function firmConfig(slug: string, domain: string, adminEmail: string) {
  return {
    slug,
    name: `Platform Probe ${slug}`,
    shortName: 'PPC',
    primaryDomain: domain,
    invoicePrefix: 'PPC',
    admin: { email: adminEmail, name: 'Platform Probe Admin', position: 'Admin' },
    branding: {
      documentName: 'PLATFORM PROBE FIRM C',
      palette: { primary: '#0F2A44', accent: '#B08D57' },
      nameLines: ['PLATFORM PROBE'],
      tagline: '',
      fontSet: 'standard',
    },
    email: {
      fromName: 'Platform Probe',
      fromAddress: 'noreply@platform-probe-c.lumilex.test',
      financeAddress: '',
      ipAddress: '',
      complianceAddress: '',
      ownedDomains: ['platform-probe-c.lumilex.test'],
    },
    documents: { financeRoot: '', corporateRoot: '' },
    features: ['portal'],
  };
}

const COMPLETE_INVOICE_SETTINGS = {
  firmAddress: '1 Probe Street',
  firmAddress2: '',
  firmTIN: '000-000-000',
  bankName: 'Probe Bank',
  bankAccountNo: '1234567890',
  bankAccountName: 'Platform Probe Firm A',
  signerName: 'Probe Signer',
  invoicePrefix: 'PPA',
};

/**
 * Every mutating `/api/platform/*` route, with a body that WOULD work.
 *
 * The paths are thunks because firm A's id isn't known until the fixtures are
 * provisioned, and the check names have to exist before that (the skip path
 * needs them when there is no dev server).
 */
interface Mutation {
  label: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: () => string;
  body: () => unknown;
}

const MUTATIONS: Mutation[] = [
  {
    label: 'create a firm',
    method: 'POST',
    path: () => '/api/platform/firms',
    body: () => firmConfig(SLUG_DENIED, `${SLUG_DENIED}.lumilex.test`, EMAILS.deniedOperator),
  },
  {
    label: "rename a firm",
    method: 'PATCH',
    path: () => `/api/platform/firms/${fx.A}`,
    body: () => ({ section: 'identity', name: 'DENIED RENAME', shortName: 'DENY' }),
  },
  {
    label: "rewrite a firm's invoice settings",
    method: 'PUT',
    path: () => `/api/platform/firms/${fx.A}/invoice-settings`,
    body: () => ({ ...COMPLETE_INVOICE_SETTINGS, invoicePrefix: 'DENY' }),
  },
  {
    label: 'add a domain to a firm',
    method: 'POST',
    path: () => `/api/platform/firms/${fx.A}/domains`,
    body: () => ({ domain: DOMAIN_A_DENIED }),
  },
  {
    label: "change a firm's primary domain",
    method: 'PATCH',
    path: () => `/api/platform/firms/${fx.A}/domains`,
    body: () => ({ domain: DOMAIN_A_EXTRA }),
  },
  {
    label: 'remove a firm domain',
    method: 'DELETE',
    path: () => `/api/platform/firms/${fx.A}/domains`,
    body: () => ({ domain: DOMAIN_A_EXTRA }),
  },
  {
    label: 'turn a feature on for a firm',
    method: 'PATCH',
    path: () => `/api/platform/firms/${fx.A}/features`,
    body: () => ({ key: 'portal', entitled: true, enabled: true }),
  },
  {
    label: 'add a platform operator',
    method: 'POST',
    path: () => '/api/platform/operators',
    body: () => ({
      email: EMAILS.deniedOperator,
      password: 'Denied-Operator-Password-1!',
      name: 'Platform Probe Denied',
    }),
  },
  {
    label: 'reactivate a revoked platform operator',
    method: 'PATCH',
    path: () => '/api/platform/operators',
    body: () => ({ authUserId: fxIds.disabledOperator, active: true }),
  },
];

const DENY_PERSONAS = [
  'anon',
  "a firm's super_user",
  'a deactivated operator',
] as const;

const MUTATION_DENY_CHECKS = MUTATIONS.flatMap((m) =>
  DENY_PERSONAS.map((persona) => `${persona} cannot ${m.label} (${m.method} ${m.label})`),
);

const MUTATION_EFFECT_CHECKS = [
  'no refused request created a firm',
  'no refused request renamed a firm',
  'no refused request rewrote invoice settings',
  'no refused request touched a firm’s domains',
  'no refused request registered or enabled a feature',
  'no refused request added or reactivated an operator',
];

const MUTATION_ALLOW_CHECKS = [
  'allow control: an operator creates a firm',
  'allow control: an operator renames a firm',
  'allow control: an operator completes a firm’s invoice settings',
  'allow control: an operator adds, promotes and removes a firm domain',
  'allow control: an operator entitles and switches a feature on',
  'allow control: an operator adds another operator',
  'allow control: an operator deactivates another operator',
  'an operator cannot deactivate their own access without confirming it',
  'every operator mutation lands in the audit log of the firm it concerns',
];

const CREATED_FIRM_CHECKS = [
  'the created firm is listed, active, and on its own primary domain',
  'the created firm’s invoice row exists with its own prefix and is deliberately incomplete',
  'the created firm has every integration registered and every one disabled',
  'the created firm has the seed pack',
  'the created firm’s first admin can sign in and resolves to that firm',
];

/** Reads a JSON body, or null when the reply was a redirect or HTML. */
function json(reply: Reply): Record<string, unknown> | null {
  try {
    return JSON.parse(reply.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const fxIds = { disabledOperator: '', operator: '' };

async function mutationProbe(cookies: Record<string, string>): Promise<void> {
  console.log('── every mutation refuses anon, a firm’s super_user, and a deactivated operator ──');

  const personaCookie: Record<(typeof DENY_PERSONAS)[number], string | undefined> = {
    anon: undefined,
    "a firm's super_user": cookies.superUser,
    'a deactivated operator': cookies.disabled,
  };

  let i = 0;
  for (const mutation of MUTATIONS) {
    for (const persona of DENY_PERSONAS) {
      const reply = await send(
        mutation.method,
        mutation.path(),
        personaCookie[persona],
        mutation.body(),
      );
      record(
        MUTATION_DENY_CHECKS[i],
        refused(reply),
        `HTTP ${reply.status}${reply.location ? ` → ${reply.location}` : ''} — ${reply.body.slice(0, 120)}`,
      );
      i += 1;
    }
  }

  console.log('── …and none of them actually did anything ──');
  // A 302 that still performed the write is the failure mode a status-only
  // deny check cannot see, so look for each mutation's own footprint.
  const { data: deniedFirm } = await service
    .from('firms')
    .select('id')
    .eq('slug', SLUG_DENIED)
    .maybeSingle();
  record(MUTATION_EFFECT_CHECKS[0], !deniedFirm, `firms row for ${SLUG_DENIED}: ${JSON.stringify(deniedFirm)}`);

  const { data: firmA } = await service
    .from('firms')
    .select('name, settings')
    .eq('id', fx.A)
    .maybeSingle();
  record(
    MUTATION_EFFECT_CHECKS[1],
    firmA?.name === 'Platform Probe Firm A',
    `firm A name: ${firmA?.name}`,
  );

  const { data: invoiceA } = await service
    .from('firm_invoice_settings')
    .select('invoice_prefix')
    .eq('firm_id', fx.A)
    .maybeSingle();
  record(
    MUTATION_EFFECT_CHECKS[2],
    invoiceA?.invoice_prefix === 'PPA',
    `firm A invoice prefix: ${invoiceA?.invoice_prefix}`,
  );

  const { data: domainsA } = await service
    .from('firm_domains')
    .select('domain, is_primary')
    .eq('firm_id', fx.A);
  const domainSet = (domainsA ?? []) as { domain: string; is_primary: boolean }[];
  record(
    MUTATION_EFFECT_CHECKS[3],
    domainSet.length === 2 &&
      domainSet.some((d) => d.domain === DOMAIN_A && d.is_primary) &&
      domainSet.some((d) => d.domain === DOMAIN_A_EXTRA && !d.is_primary) &&
      !domainSet.some((d) => d.domain === DOMAIN_A_DENIED),
    `firm A domains: ${JSON.stringify(domainSet)}`,
  );

  const { data: integrationsA } = await service
    .from('firm_integrations')
    .select('feature, enabled')
    .eq('firm_id', fx.A);
  const entitlements = (firmA?.settings as { features?: Record<string, boolean> } | null)?.features;
  record(
    MUTATION_EFFECT_CHECKS[4],
    (integrationsA ?? []).length === 0 && !entitlements?.portal,
    `firm A integrations: ${JSON.stringify(integrationsA)}; entitlements: ${JSON.stringify(entitlements)}`,
  );

  const { data: operatorRows } = await service
    .from('platform_operators')
    .select('email, active')
    .like('email', `${EMAIL_PREFIX}%`);
  const ops = (operatorRows ?? []) as { email: string; active: boolean }[];
  record(
    MUTATION_EFFECT_CHECKS[5],
    !ops.some((o) => o.email === EMAILS.deniedOperator) &&
      ops.find((o) => o.email === EMAILS.disabled)?.active === false,
    `probe operators: ${JSON.stringify(ops)}`,
  );

  console.log('── allow controls: the same requests, as an operator ──');

  const created = await send(
    'POST',
    '/api/platform/firms',
    cookies.operator,
    firmConfig(SLUG_CREATED, DOMAIN_CREATED, EMAILS.createdAdmin),
  );
  const createdJson = json(created);
  const createdFirmId = (createdJson?.firmId as string) ?? '';
  const createdPassword =
    ((createdJson?.admin as { password?: string } | undefined)?.password as string) ?? '';
  record(
    MUTATION_ALLOW_CHECKS[0],
    created.status === 200 && !!createdFirmId && !!createdPassword,
    `HTTP ${created.status} — ${created.body.slice(0, 200)}`,
  );

  const renamed = await send('PATCH', `/api/platform/firms/${fx.A}`, cookies.operator, {
    section: 'identity',
    name: 'Platform Probe Firm A (renamed)',
    shortName: 'PPA',
  });
  record(
    MUTATION_ALLOW_CHECKS[1],
    renamed.status === 200 &&
      (json(renamed)?.firm as { name?: string } | undefined)?.name ===
        'Platform Probe Firm A (renamed)',
    `HTTP ${renamed.status} — ${renamed.body.slice(0, 160)}`,
  );

  const invoiceSaved = await send(
    'PUT',
    `/api/platform/firms/${fx.A}/invoice-settings`,
    cookies.operator,
    COMPLETE_INVOICE_SETTINGS,
  );
  const invoicePayload = json(invoiceSaved)?.invoice as
    | { missing?: string[]; settings?: { invoicePrefix?: string } }
    | undefined;
  record(
    MUTATION_ALLOW_CHECKS[2],
    invoiceSaved.status === 200 &&
      (invoicePayload?.missing ?? ['x']).length === 0 &&
      invoicePayload?.settings?.invoicePrefix === 'PPA',
    `HTTP ${invoiceSaved.status} — ${invoiceSaved.body.slice(0, 200)}`,
  );

  const domainPath = `/api/platform/firms/${fx.A}/domains`;
  const added = await send('POST', domainPath, cookies.operator, { domain: DOMAIN_A_ADDED });
  const promoted = await send('PATCH', domainPath, cookies.operator, { domain: DOMAIN_A_EXTRA });
  const restored = await send('PATCH', domainPath, cookies.operator, { domain: DOMAIN_A });
  const removed = await send('DELETE', domainPath, cookies.operator, { domain: DOMAIN_A_ADDED });
  const finalDomains = (json(removed)?.domains ?? []) as { domain: string; isPrimary: boolean }[];
  record(
    MUTATION_ALLOW_CHECKS[3],
    [added, promoted, restored, removed].every((r) => r.status === 200) &&
      finalDomains.length === 2 &&
      finalDomains.find((d) => d.isPrimary)?.domain === DOMAIN_A &&
      !finalDomains.some((d) => d.domain === DOMAIN_A_ADDED),
    `add ${added.status}, promote ${promoted.status}, restore ${restored.status}, ` +
      `remove ${removed.status}; final: ${JSON.stringify(finalDomains)}`,
  );

  const featureOn = await send('PATCH', `/api/platform/firms/${fx.A}/features`, cookies.operator, {
    key: 'portal',
    entitled: true,
    enabled: true,
  });
  const featureRows = (json(featureOn)?.features ?? []) as {
    key: string;
    available: boolean;
    reason: string;
  }[];
  const portal = featureRows.find((f) => f.key === 'portal');
  record(
    MUTATION_ALLOW_CHECKS[4],
    featureOn.status === 200 && portal?.available === true,
    `HTTP ${featureOn.status} — portal: ${JSON.stringify(portal)}`,
  );

  const opAdded = await send('POST', '/api/platform/operators', cookies.operator, {
    email: EMAILS.addedOperator,
    password: 'Added-Operator-Password-1!',
    name: 'Platform Probe Added',
  });
  const roster = (json(opAdded)?.operators ?? []) as {
    email: string;
    active: boolean;
    authUserId: string;
  }[];
  const addedOperator = roster.find((o) => o.email === EMAILS.addedOperator);
  record(
    MUTATION_ALLOW_CHECKS[5],
    opAdded.status === 200 && addedOperator?.active === true,
    `HTTP ${opAdded.status} — ${opAdded.body.slice(0, 200)}`,
  );

  const opOff = await send('PATCH', '/api/platform/operators', cookies.operator, {
    authUserId: addedOperator?.authUserId ?? '00000000-0000-0000-0000-000000000000',
    active: false,
  });
  const rosterAfter = (json(opOff)?.operators ?? []) as { email: string; active: boolean }[];
  record(
    MUTATION_ALLOW_CHECKS[6],
    opOff.status === 200 &&
      rosterAfter.find((o) => o.email === EMAILS.addedOperator)?.active === false,
    `HTTP ${opOff.status} — ${opOff.body.slice(0, 200)}`,
  );

  // The lockout guard, through the route. The "last active operator" branch is
  // not asserted here — how many operators this database has is not the
  // probe's to control, and inventing that state would mean deactivating real
  // ones. That branch is covered mocklessly in lib/platform/operator-lockout.test.ts;
  // what this proves is that the route consults the rule at all.
  const selfOff = await send('PATCH', '/api/platform/operators', cookies.operator, {
    authUserId: fxIds.operator,
    active: false,
  });
  const selfBody = json(selfOff);
  record(
    MUTATION_ALLOW_CHECKS[7],
    selfOff.status === 409 &&
      (selfBody?.code === 'self_unconfirmed' || selfBody?.code === 'last_operator'),
    `HTTP ${selfOff.status} — ${selfOff.body.slice(0, 200)}`,
  );

  console.log('── the mutations are audited into the firm they concern ──');
  let mutationAudit: { action: string; entity_type: string }[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data } = await service
      .from('audit_log')
      .select('action, entity_type')
      .eq('firm_id', fx.A)
      .eq('actor_type', 'operator')
      .neq('action', 'viewed');
    mutationAudit = (data ?? []) as { action: string; entity_type: string }[];
    if (mutationAudit.some((r) => r.entity_type === 'FirmIntegration')) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const auditedTypes = new Set(mutationAudit.map((r) => r.entity_type));
  record(
    MUTATION_ALLOW_CHECKS[8],
    ['Firm', 'FirmInvoiceSettings', 'FirmDomain', 'FirmIntegration'].every((t) =>
      auditedTypes.has(t),
    ),
    `audited entity types in firm A's log: ${[...auditedTypes].join(', ') || 'none'}`,
  );

  await createdFirmProbe(createdFirmId, createdPassword);
}

/**
 * The provisioning path's guarantees still hold when it is reached through the
 * form. "Usable" is not "the row exists": the last check signs the first admin
 * in for real, because a firm nobody can get into is not provisioned.
 */
async function createdFirmProbe(firmId: string, password: string): Promise<void> {
  console.log('── the firm created through the form is immediately usable ──');

  if (!firmId) {
    for (const name of CREATED_FIRM_CHECKS) {
      skip(name, 'the create-firm control failed — there is no firm to inspect');
    }
    return;
  }

  const { data: firm } = await service
    .from('firms')
    .select('slug, status, settings')
    .eq('id', firmId)
    .maybeSingle();
  const { data: domains } = await service
    .from('firm_domains')
    .select('domain, is_primary')
    .eq('firm_id', firmId);
  record(
    CREATED_FIRM_CHECKS[0],
    firm?.slug === SLUG_CREATED &&
      firm?.status === 'active' &&
      (domains ?? []).some(
        (d) => d.domain === DOMAIN_CREATED && d.is_primary === true,
      ),
    `firm: ${JSON.stringify(firm?.slug)}/${firm?.status}; domains: ${JSON.stringify(domains)}`,
  );

  const { data: invoice } = await service
    .from('firm_invoice_settings')
    .select('invoice_prefix, bank_name, firm_tin')
    .eq('firm_id', firmId)
    .maybeSingle();
  // The placeholders are the guarantee, not a shortfall: billing refuses until
  // finance replaces them, which is what stops an invoice naming nobody.
  record(
    CREATED_FIRM_CHECKS[1],
    invoice?.invoice_prefix === 'PPC' &&
      String(invoice?.bank_name ?? '').startsWith('PLACEHOLDER —') &&
      String(invoice?.firm_tin ?? '').startsWith('PLACEHOLDER —'),
    `invoice settings: ${JSON.stringify(invoice)}`,
  );

  const { data: integrations } = await service
    .from('firm_integrations')
    .select('feature, enabled')
    .eq('firm_id', firmId);
  const rows = (integrations ?? []) as { feature: string; enabled: boolean }[];
  record(
    CREATED_FIRM_CHECKS[2],
    rows.length === FEATURE_KEYS.length && rows.every((r) => r.enabled === false),
    `${rows.length}/${FEATURE_KEYS.length} integration rows, enabled: ${rows.filter((r) => r.enabled).map((r) => r.feature).join(', ') || 'none'}`,
  );

  const [enums, schedules, profiles] = await Promise.all([
    service.from('enum_options').select('value', { count: 'exact', head: true }).eq('firm_id', firmId),
    service.from('fee_schedules').select('slug', { count: 'exact', head: true }).eq('firm_id', firmId),
    service.from('firm_profiles').select('id', { count: 'exact', head: true }).eq('firm_id', firmId),
  ]);
  record(
    CREATED_FIRM_CHECKS[3],
    (enums.count ?? 0) > 0 && (schedules.count ?? 0) > 0 && (profiles.count ?? 0) === 1,
    `enum_options ${enums.count}, fee_schedules ${schedules.count}, firm_profiles ${profiles.count}`,
  );

  const client = createClient(URL_, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email: EMAILS.createdAdmin,
    password,
  });
  const { data: teamRow } = await service
    .from('team')
    .select('firm_id, role, active')
    .eq('email', EMAILS.createdAdmin)
    .maybeSingle();
  record(
    CREATED_FIRM_CHECKS[4],
    !signInErr &&
      !!signIn?.user &&
      teamRow?.firm_id === firmId &&
      teamRow?.role === 'admin' &&
      teamRow?.active === true,
    `sign-in: ${signInErr?.message ?? 'ok'}; team row: ${JSON.stringify(teamRow)}`,
  );
}

async function handlerProbe(): Promise<void> {
  const liveChecks = [
    ...HANDLER_CHECKS,
    ...MUTATION_DENY_CHECKS,
    ...MUTATION_EFFECT_CHECKS,
    ...MUTATION_ALLOW_CHECKS,
    ...CREATED_FIRM_CHECKS,
  ];

  if (!(await serverIsUp())) {
    const why = `no dev server at ${BASE_URL} — run \`npm run dev\` (or set PROBE_BASE_URL)`;
    for (const name of liveChecks) {
      if (process.argv.includes('--require-live')) record(name, false, why);
      else skip(name, why);
    }
    return;
  }

  const cookies = {
    operator: await sessionCookie(EMAILS.operator),
    superUser: await sessionCookie(EMAILS.superUser),
    disabled: await sessionCookie(EMAILS.disabled),
    dual: await sessionCookie(EMAILS.dual),
  };

  console.log('── controls: the surface actually works for an operator ──');
  const opPage = await get('/platform', cookies.operator);
  record(
    HANDLER_CHECKS[0],
    opPage.status === 200 && FIXTURE_SLUGS.every((slug) => opPage.body.includes(slug)),
    `HTTP ${opPage.status}${opPage.location ? ` → ${opPage.location}` : ''}; ` +
      `slugs present: ${FIXTURE_SLUGS.filter((s) => opPage.body.includes(s)).join(', ') || 'none'}`,
  );

  const opApi = await get('/api/platform/firms', cookies.operator);
  let listed: { slug: string; issues: string[] }[] = [];
  try {
    listed = (JSON.parse(opApi.body).firms ?? []) as { slug: string; issues: string[] }[];
  } catch {
    /* redirect or HTML */
  }
  record(
    HANDLER_CHECKS[1],
    opApi.status === 200 && FIXTURE_SLUGS.every((slug) => listed.some((f) => f.slug === slug)),
    `HTTP ${opApi.status} — ${opApi.body.slice(0, 200)}`,
  );

  const complete = listed.find((f) => f.slug === SLUG_A);
  const halfDone = listed.find((f) => f.slug === SLUG_B);
  record(
    HANDLER_CHECKS[2],
    (complete?.issues.length ?? -1) === 0 && (halfDone?.issues.length ?? 0) > 0,
    `complete firm issues: ${JSON.stringify(complete?.issues)}; ` +
      `half-provisioned firm issues: ${JSON.stringify(halfDone?.issues)}`,
  );

  if (opPage.status !== 200 || opApi.status !== 200) {
    for (const name of [
      ...HANDLER_CHECKS.slice(3),
      ...MUTATION_DENY_CHECKS,
      ...MUTATION_EFFECT_CHECKS,
      ...MUTATION_ALLOW_CHECKS,
      ...CREATED_FIRM_CHECKS,
    ]) {
      skip(name, 'control failed — a refusal below would prove nothing');
    }
    return;
  }

  console.log('── denials ──');
  const anonPage = await get('/platform');
  record(HANDLER_CHECKS[3], refused(anonPage), `HTTP ${anonPage.status} → ${anonPage.location}`);

  const anonApi = await get('/api/platform/firms');
  record(HANDLER_CHECKS[4], refused(anonApi), `HTTP ${anonApi.status} → ${anonApi.location}`);

  const suPage = await get('/platform', cookies.superUser);
  record(HANDLER_CHECKS[5], refused(suPage), `HTTP ${suPage.status} → ${suPage.location}`);

  const suApi = await get('/api/platform/firms', cookies.superUser);
  record(HANDLER_CHECKS[6], refused(suApi), `HTTP ${suApi.status} → ${suApi.location}`);

  // 403 would confirm the surface exists to anyone who guessed the path.
  record(
    HANDLER_CHECKS[7],
    suPage.status >= 300 && suPage.status < 400 && (suPage.location ?? '').includes('/dashboard'),
    `HTTP ${suPage.status} → ${suPage.location}`,
  );

  const offPage = await get('/platform', cookies.disabled);
  record(HANDLER_CHECKS[8], refused(offPage), `HTTP ${offPage.status} → ${offPage.location}`);

  const offApi = await get('/api/platform/firms', cookies.disabled);
  record(HANDLER_CHECKS[9], refused(offApi), `HTTP ${offApi.status} → ${offApi.location}`);

  console.log('── the person who is both ──');
  // Also the whitelabel-binding check: the /platform branch returns before the
  // host binding runs, so a staff-operator is not bounced off the platform host
  // onto their firm's domain.
  const dualPage = await get('/platform', cookies.dual);
  record(
    HANDLER_CHECKS[10],
    dualPage.status === 200,
    `HTTP ${dualPage.status} → ${dualPage.location}`,
  );

  const { data: dualTeam } = await service
    .from('team')
    .select('role, firm_id, active')
    .eq('email', EMAILS.dual)
    .maybeSingle();
  record(
    HANDLER_CHECKS[11],
    dualTeam?.role === 'lawyer' && dualTeam?.firm_id === fx.A,
    `team row: ${JSON.stringify(dualTeam)}`,
  );

  console.log('── audit ──');
  // Opening a firm is the act that reads its configuration, and the detail page
  // is what audits it — the firms LIST deliberately does not, so that a server
  // component with no dedup cannot bury a tenant's log under a row per render
  // (see the operator-surface section in CLAUDE.md). So drive the surface that
  // actually carries the rule, once per probe firm, and assert both landed.
  for (const firmId of [fx.A, fx.B]) {
    const detail = await get(`/platform/firms/${firmId}`, cookies.operator);
    if (detail.status !== 200) {
      console.log(`   ! detail page for ${firmId} returned HTTP ${detail.status}`);
    }
  }

  // logOperatorAudit defers past the response with after(), so give it a beat.
  let auditRows: { firm_id: string; actor_type: string }[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data } = await service
      .from('audit_log')
      .select('firm_id, actor_type, action, performed_by_name')
      .in('firm_id', [fx.A, fx.B])
      .eq('actor_type', 'operator');
    auditRows = (data ?? []) as { firm_id: string; actor_type: string }[];
    if (auditRows.some((r) => r.firm_id === fx.A) && auditRows.some((r) => r.firm_id === fx.B)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  record(
    HANDLER_CHECKS[12],
    auditRows.some((r) => r.firm_id === fx.A) && auditRows.some((r) => r.firm_id === fx.B),
    `operator audit rows: ${JSON.stringify(auditRows)}`,
  );

  await mutationProbe(cookies);
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('── teardown of any prior probe run ──');
  await teardown();

  console.log('── provisioning platform probe fixtures ──');
  await provisionFixtures();

  await databaseProbe();
  await handlerProbe();

  console.log('── teardown ──');
  await teardown();

  const failures = checks.filter((c) => !c.pass);
  const skipped = checks.filter((c) => c.skipped).length;
  console.log(
    `\n${checks.length - failures.length - skipped}/${checks.length} checks pass` +
      (skipped ? `, ${skipped} skipped` : ''),
  );
  if (failures.length > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await teardown();
  } catch {
    /* best effort */
  }
  process.exit(1);
});
