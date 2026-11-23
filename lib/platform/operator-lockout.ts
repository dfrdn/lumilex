/**
 * May this deactivation go ahead?
 *
 * Split out with no imports at all, same reasoning as `firm-issues.ts`: the
 * rule is the interesting part and it should be testable without a database.
 *
 * ── The lockout case ────────────────────────────────────────────────
 *
 * `platform_operators` is deny-by-default RLS and has no self-service recovery.
 * If the last active operator is deactivated, `/platform` is unreachable by
 * everyone — `getOperatorSession` filters on `active`, `proxy.ts` redirects
 * whoever is left to `/dashboard`, and the only way back in is
 * `scripts/bootstrap-platform-operator.ts` run by someone holding the
 * service-role key. That is a real recovery path, not a brick, but it is a
 * shell on a laptop and it is not always the person who just clicked the
 * button. So the surface refuses to be the thing that closes itself.
 *
 * Two distinct refusals, deliberately not merged:
 *
 *   - **last active operator** — refused outright, whoever is asking. This is
 *     the platform-lockout case and no confirmation makes it safe, because the
 *     operator confirming cannot undo it afterwards.
 *   - **deactivating yourself while others remain** — allowed, but only when
 *     the caller says so explicitly. It is recoverable (another operator can
 *     reactivate) so refusing outright would be paternalistic; it is also
 *     irreversible *for the person doing it*, which is exactly the shape of
 *     click that should not happen by accident on a row in a list.
 */

export interface DeactivationRequest {
  /** The operator being deactivated. */
  targetAuthUserId: string;
  /** The operator doing it. */
  actorAuthUserId: string;
  /** Every currently-active operator's auth_user_id, target included. */
  activeAuthUserIds: readonly string[];
  /** The caller has explicitly acknowledged that this is their own access. */
  confirmSelf?: boolean;
}

export type DeactivationVerdict =
  | { ok: true; self: boolean }
  | { ok: false; code: 'not_active' | 'last_operator' | 'self_unconfirmed'; message: string };

export function checkOperatorDeactivation(req: DeactivationRequest): DeactivationVerdict {
  const active = new Set(req.activeAuthUserIds);

  if (!active.has(req.targetAuthUserId)) {
    return {
      ok: false,
      code: 'not_active',
      message: 'That operator is already deactivated.',
    };
  }

  if (active.size <= 1) {
    return {
      ok: false,
      code: 'last_operator',
      message:
        'This is the last active platform operator. Deactivating it would close /platform to ' +
        'everyone, and the only way back in is scripts/bootstrap-platform-operator.ts run with ' +
        'the service-role key. Add another operator first.',
    };
  }

  const self = req.targetAuthUserId === req.actorAuthUserId;
  if (self && !req.confirmSelf) {
    return {
      ok: false,
      code: 'self_unconfirmed',
      message:
        'That is your own operator access. You will be signed out of /platform and only another ' +
        'operator can restore it. Confirm to proceed.',
    };
  }

  return { ok: true, self };
}
