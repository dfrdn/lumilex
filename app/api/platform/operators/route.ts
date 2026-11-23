import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  requireOperator,
  listOperators,
  createOperator,
  setOperatorActive,
  OperatorAdminError,
} from '@/lib/platform/auth';
import { allFirmIds } from '@/lib/platform/firms';
import { checkOperatorDeactivation } from '@/lib/platform/operator-lockout';
import { validateBody } from '@/lib/validation';
import { logOperatorAuditAcrossFirms, getClientIP } from '@/lib/audit';

/**
 * The operator roster.
 *
 * ── Where these audit rows go ────────────────────────────────────────
 *
 * `audit_log` is a tenant table and `firm_id` is NOT NULL, and phase A rejected
 * a sentinel "platform" firm for good reasons (`forEachActiveFirm` would
 * enumerate it and every cron would fan out to a fake tenant). Granting or
 * revoking operator access is nevertheless not firm-less in effect: a new
 * operator is a new person who can read every tenant's configuration and edit
 * it. So it is audited into *every* firm's log through
 * `logOperatorAuditAcrossFirms` — the same helper phase A built for an action
 * touching several firms — rather than nowhere.
 */
const createSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email()),
  // Long enough to be a real credential rather than a placeholder someone
  // means to change later; there is no password reset flow on this surface.
  password: z.string().min(12).max(200),
  name: z.string().trim().max(200).optional(),
});

const activeSchema = z.object({
  authUserId: z.string().uuid(),
  active: z.boolean(),
  /** Required to deactivate your own access — see lib/platform/operator-lockout.ts. */
  confirmSelf: z.boolean().optional(),
});

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  return NextResponse.json({ operators: await listOperators() });
}

export async function POST(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { operator } = guard;

  const validation = await validateBody(req, createSchema);
  if (!validation.success) return validation.response;

  let result;
  try {
    result = await createOperator(validation.data);
  } catch (err) {
    if (err instanceof OperatorAdminError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  if (result.outcome !== 'exists') {
    logOperatorAuditAcrossFirms(await allFirmIds(), {
      entityType: 'PlatformOperator',
      entityId: result.operator.authUserId,
      entityName: result.operator.email,
      action: result.outcome === 'created' ? 'created' : 'reactivated',
      fieldChanged: 'platform operator access',
      newValue: `${result.operator.email} can read and edit every firm's configuration`,
      operator,
      ipAddress: getClientIP(req),
    });
  }

  return NextResponse.json({
    outcome: result.outcome,
    operators: await listOperators(),
  });
}

/**
 * Deactivate or reactivate.
 *
 * The lockout rule lives in `checkOperatorDeactivation`, which is pure and
 * tested: the last active operator is refused outright (no confirmation makes
 * it safe, because the operator confirming cannot undo it), and deactivating
 * your own access while others remain needs an explicit acknowledgement.
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { operator } = guard;

  const validation = await validateBody(req, activeSchema);
  if (!validation.success) return validation.response;
  const { authUserId, active, confirmSelf } = validation.data;

  const roster = await listOperators();
  const target = roster.find((o) => o.authUserId === authUserId);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!active) {
    const verdict = checkOperatorDeactivation({
      targetAuthUserId: authUserId,
      actorAuthUserId: operator.authUserId,
      activeAuthUserIds: roster.filter((o) => o.active).map((o) => o.authUserId),
      confirmSelf,
    });
    if (!verdict.ok) {
      return NextResponse.json(
        { error: verdict.message, code: verdict.code },
        // 409: the request is well-formed and the caller is authorized; the
        // roster is simply in a state where this would close the surface.
        { status: verdict.code === 'not_active' ? 404 : 409 },
      );
    }
  } else if (target.active) {
    return NextResponse.json({ operators: roster });
  }

  await setOperatorActive(authUserId, active);

  logOperatorAuditAcrossFirms(await allFirmIds(), {
    entityType: 'PlatformOperator',
    entityId: authUserId,
    entityName: target.email,
    action: active ? 'reactivated' : 'deactivated',
    fieldChanged: 'platform operator access',
    oldValue: target.active ? 'active' : 'inactive',
    newValue: active ? 'active' : 'inactive',
    operator,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ operators: await listOperators() });
}
