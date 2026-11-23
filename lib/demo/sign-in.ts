import { isDemoPersonaKey, type DemoPersonaKey } from '@/lib/demo/personas';

/**
 * Who may be signed in by the demo's one-click sign-in — pure, so the whole
 * decision is tested without a database. The route
 * (app/api/auth/demo/route.ts) is the IO around it.
 *
 * This is a sign-in that asks for no secret, so it holds three conditions and
 * no fewer:
 *
 *   1. The deployment declares itself a demo (`LUMILEX_INSTANCE_ROLE=demo`).
 *      An env var on purpose: it is a safety interlock that no edit to a
 *      firm's settings can flip, so a mistaken `/platform` change on a real
 *      firm's instance cannot open its staff accounts to the internet.
 *   2. The firm the request's host resolves to has `settings.demo.enabled`.
 *   3. The account is one of that firm's registered personas — resolved by
 *      person id from `settings.demo.personas`, never taken from the request —
 *      and is an active staff row with a login, in that firm, and not a
 *      super_user (a developer escape hatch nobody should be handed).
 *
 * Refusals are reported to the route by reason for its log; the visitor sees
 * the same page whichever one it was.
 */

export interface DemoSettingsInput {
  enabled: boolean;
  personas: ReadonlyArray<{ key: DemoPersonaKey; personId: string }>;
}

export interface DemoMemberInput {
  personId: string;
  firmId: string;
  role: string;
  active: boolean;
  authUserId: string | null;
}

export type DemoSignInRefusal =
  | 'not_a_demo_deployment'
  | 'firm_not_demo'
  | 'unknown_persona'
  | 'persona_unavailable';

export type DemoPersonaDecision =
  | { ok: true; personId: string }
  | { ok: false; reason: DemoSignInRefusal };

export function isDemoDeploymentEnv(env: Record<string, string | undefined>): boolean {
  return env.LUMILEX_INSTANCE_ROLE === 'demo';
}

/** Conditions 1 and 2, and which staff member the requested role maps to. */
export function resolveDemoPersona(input: {
  deploymentIsDemo: boolean;
  demo: DemoSettingsInput | null;
  as: unknown;
}): DemoPersonaDecision {
  if (!input.deploymentIsDemo) return { ok: false, reason: 'not_a_demo_deployment' };
  if (!input.demo?.enabled) return { ok: false, reason: 'firm_not_demo' };
  if (!isDemoPersonaKey(input.as)) return { ok: false, reason: 'unknown_persona' };
  const persona = input.demo.personas.find((p) => p.key === input.as);
  if (!persona) return { ok: false, reason: 'unknown_persona' };
  return { ok: true, personId: persona.personId };
}

/** Condition 3: the row the persona resolved to is one it is safe to hand out. */
export function demoMemberUsable(
  member: DemoMemberInput | null,
  expected: { firmId: string; personId: string },
): boolean {
  if (!member) return false;
  return (
    member.firmId === expected.firmId &&
    member.personId === expected.personId &&
    member.active &&
    !!member.authUserId &&
    member.role !== 'super_user'
  );
}
