/**
 * The platform operator session — the third identity kind.
 *
 * `getSession()` resolves a firm's staff member out of `team`;
 * `getPortalSession()` resolves a firm's client out of `client_users`. Both
 * carry a `firmId` and everything downstream of them is scoped to it. This one
 * resolves a `platform_operators` row and carries **no firm at all**, because
 * the surface it guards (`/platform`) is the one that deliberately crosses
 * tenants.
 *
 * ── An operator is not a staff member with extra rights ──────────────
 *
 * The three lookups are disjoint by construction: this module never reads
 * `team`, and `lib/session.ts` never reads `platform_operators`. A person who
 * is both — an operator who also has a `team` row at some firm — is legal, and
 * the two sessions stay distinct:
 *
 *   - on a firm surface they are staff, with exactly their `team.role`. Being
 *     an operator adds nothing there; `session.user.role` is unchanged and no
 *     role check consults this table.
 *   - on `/platform` they are an operator, with no firm. Their `team` row
 *     grants them nothing here and their firm's branding is not applied.
 *
 * Nothing merges the two. That separation is the point of the design: the
 * conversion's whole thesis is that a firm-scoped row must never confer
 * cross-firm power, so `super_user` (a `team.role`) must not reach `/platform`
 * and an operator must not inherit a firm. `proxy.ts` enforces the same split
 * by branching on the path *before* it looks anyone up in `team`.
 *
 * `platform_operators` is a global table with deny-by-default RLS (no
 * policies), so the raw service-role client is the only way to read it — see
 * the `platform-operator` group in eslint.config.mjs.
 */
import { cache } from 'react';
import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { getAuthUserId } from '@/lib/session';

export interface OperatorSession {
  authUserId: string;
  email: string;
  /** Optional on the row; null rather than a guessed display name. */
  name: string | null;
}

/**
 * The current request's platform operator, or null.
 *
 * Same caching and the same auth resolution as `getSession` /
 * `getPortalSession`: React `cache` per request, and the shared
 * `getAuthUserId()` so the Bearer-or-cookie precedence rule lives in one place.
 *
 * `active` is part of the query, not a field the caller inspects — a
 * deactivated operator must be indistinguishable from a person who was never
 * one, at every call site, without any of them remembering to check.
 */
export const getOperatorSession = cache(async (): Promise<OperatorSession | null> => {
  const authUserId = await getAuthUserId();
  if (!authUserId) return null;

  const { data } = await getSupabase()
    .from('platform_operators')
    .select('auth_user_id, email, name')
    .eq('auth_user_id', authUserId)
    .eq('active', true)
    .maybeSingle();

  if (!data) return null;

  return {
    authUserId: data.auth_user_id as string,
    email: data.email as string,
    name: (data.name as string | null) ?? null,
  };
});

export type OperatorGuardResult =
  | { ok: true; operator: OperatorSession }
  | { ok: false; response: NextResponse };

/**
 * Defense-in-depth for `/api/platform/*` handlers, in the shape of
 * `requirePortalSession`. `proxy.ts` already redirects a non-operator away, so
 * this is the second gate rather than the first — and unlike every other
 * surface there is no RLS gate underneath it, because the operator's reads are
 * service-role by necessity. That makes it the last one, so no handler may
 * skip it.
 *
 *   const guard = await requireOperator();
 *   if (!guard.ok) return guard.response;
 *   const { operator } = guard;
 */
export async function requireOperator(): Promise<OperatorGuardResult> {
  const operator = await getOperatorSession();
  if (!operator) {
    // 401 and nothing else: no hint about whether the caller is signed in as
    // something else, and no confirmation of what lives behind this path.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true, operator };
}

// ── Managing the operator roster ─────────────────────────────────────
//
// Kept in this file rather than a new one because `platform_operators` is the
// table this module already owns, and reaching it needs the raw service-role
// client (deny-by-default RLS, no policies). A second file would mean a second
// entry on the eslint allowlist for the same table and the same reason, and
// that allowlist is supposed to be a list of decisions rather than a list of
// files. `scripts/bootstrap-platform-operator.ts` — which must keep working
// with no surface at all, for the first operator and for lockout recovery —
// calls the same functions.

export class OperatorAdminError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OperatorAdminError';
    this.code = code;
  }
}

export interface OperatorRow {
  authUserId: string;
  email: string;
  name: string | null;
  active: boolean;
  createdAt: string;
}

export async function listOperators(): Promise<OperatorRow[]> {
  const { data, error } = await getSupabase()
    .from('platform_operators')
    .select('auth_user_id, email, name, active, created_at')
    .order('email');
  if (error) throw new Error(`platform_operators read failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    authUserId: r.auth_user_id as string,
    email: r.email as string,
    name: (r.name as string | null) ?? null,
    active: r.active === true,
    createdAt: r.created_at as string,
  }));
}

export interface CreateOperatorResult {
  operator: OperatorRow;
  /** 'created' | 'reactivated' | 'exists' — idempotent per email. */
  outcome: 'created' | 'reactivated' | 'exists';
  /** True when a new auth.users row was made rather than an existing one bound. */
  createdAuthUser: boolean;
}

/**
 * The auth user behind an email address, or null.
 *
 * `auth.admin` has no lookup by email, so this is a scan — and it must be a
 * paginated one. Every staff member and every portal client of every tenant
 * has an `auth.users` row, so the table outgrows any single page: a first-page
 * scan would stop finding people, and "not found" here does not fail, it
 * proceeds to `createUser` and dies on the duplicate email instead. The person
 * then cannot be granted operator access at all, with an error that names the
 * wrong cause.
 *
 * `nextPage` is GoTrue's own cursor and is null on the last page; the
 * non-advancing guard is there so a server that stops honouring that contract
 * ends the scan rather than spinning.
 */
async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<User | null> {
  let page = 1;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth user list failed: ${error.message}`);

    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;

    const next = data.nextPage;
    if (next === null || next === undefined || next <= page) return null;
    page = next;
  }
}

/**
 * Add an operator, idempotently per email.
 *
 * An operator may already have an auth user — the same person can be a firm's
 * staff member and an operator, and the two identities share one sign-in while
 * staying separate rows. Bind to the existing user rather than failing, and
 * never touch their password in that case: it is not this function's to reset.
 *
 * A deactivated row is reactivated rather than colliding on the unique email.
 * Revocation stays one deliberate act away.
 */
export async function createOperator(input: {
  email: string;
  password: string;
  name?: string | null;
}): Promise<CreateOperatorResult> {
  const supabase = getSupabase();
  const email = input.email.trim().toLowerCase();
  const name = input.name?.trim() || null;

  const { data: existing, error: readErr } = await supabase
    .from('platform_operators')
    .select('auth_user_id, email, name, active, created_at')
    .eq('email', email)
    .maybeSingle();
  if (readErr) throw new Error(`platform_operators read failed: ${readErr.message}`);

  if (existing) {
    if (existing.active) {
      return {
        outcome: 'exists',
        createdAuthUser: false,
        operator: {
          authUserId: existing.auth_user_id as string,
          email: existing.email as string,
          name: (existing.name as string | null) ?? null,
          active: true,
          createdAt: existing.created_at as string,
        },
      };
    }
    const { error } = await supabase
      .from('platform_operators')
      .update({ active: true, ...(name ? { name } : {}) })
      .eq('email', email);
    if (error) throw new Error(`platform_operators reactivate failed: ${error.message}`);
    return {
      outcome: 'reactivated',
      createdAuthUser: false,
      operator: {
        authUserId: existing.auth_user_id as string,
        email,
        name: name ?? ((existing.name as string | null) ?? null),
        active: true,
        createdAt: existing.created_at as string,
      },
    };
  }

  const found = await findAuthUserByEmail(supabase, email);

  let authUserId: string;
  let createdAuthUser = false;
  if (found) {
    authUserId = found.id;
  } else {
    const { data: created, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
    if (authErr) throw new OperatorAdminError('auth_create_failed', authErr.message);
    authUserId = created.user.id;
    createdAuthUser = true;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('platform_operators')
    .insert({ auth_user_id: authUserId, email, name, active: true })
    .select('auth_user_id, email, name, active, created_at')
    .single();

  if (insertErr) {
    // Don't leave a signed-in-capable auth user with no operator row behind it.
    // Only clean up one we created — an auth user that was already there
    // belongs to a firm's staff member and deleting it would take their job
    // away with it.
    if (createdAuthUser) await supabase.auth.admin.deleteUser(authUserId);
    throw new Error(`platform_operators insert failed: ${insertErr.message}`);
  }

  return {
    outcome: 'created',
    createdAuthUser,
    operator: {
      authUserId: inserted.auth_user_id as string,
      email: inserted.email as string,
      name: (inserted.name as string | null) ?? null,
      active: inserted.active === true,
      createdAt: inserted.created_at as string,
    },
  };
}

/**
 * Flip `active`. Revocation is `active = false` — the row stays so the audit
 * trail and the email uniqueness survive, and `getOperatorSession` filters on
 * it so a deactivated operator is indistinguishable from someone who never was
 * one.
 *
 * The lockout rule is `checkOperatorDeactivation` in ./operator-lockout.ts and
 * is applied by the route, which has the actor. This function is the write.
 */
export async function setOperatorActive(authUserId: string, active: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from('platform_operators')
    .update({ active })
    .eq('auth_user_id', authUserId);
  if (error) throw new Error(`platform_operators update failed: ${error.message}`);
}
