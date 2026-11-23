import { after } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

interface AuditParams {
  /** The firm the audited action belongs to — `session.firmId` at the call site. */
  firmId: string;
  entityType: string;
  entityId?: string;
  entityName?: string;
  action: string;
  fieldChanged?: string;
  oldValue?: string;
  newValue?: string;
  performedBy: string;
  performedByName?: string;
  ipAddress?: string;
}

/**
 * An action taken by a platform operator — the cross-tenant identity from
 * lib/platform/auth.ts, which has no firm of its own.
 */
interface OperatorAuditParams extends Omit<AuditParams, 'performedBy' | 'performedByName'> {
  operator: { authUserId: string; email: string; name: string | null };
}

/** An action taken by an agent rather than a person. */
interface AgentAuditParams extends Omit<AuditParams, 'performedBy' | 'performedByName'> {
  agentId: string;
  agentName?: string;
  agentRunId?: number;
  /**
   * The person who instructed the agent, when one did. Interactive agents
   * (the assistant) have one; cron agents do not, and that distinction is
   * the whole point of recording it.
   */
  onBehalfOf?: string;
}

type AuditRow = Record<string, unknown>;

function write(firmId: string, buildRow: () => Promise<AuditRow>): void {
  const run = async () => {
    try {
      const { error } = await getServiceDbForFirm(firmId)
        .from('audit_log')
        .insert(await buildRow());
      if (error) throw new Error(error.message);
    } catch (err: unknown) {
      console.error('[audit] Failed to log:', err instanceof Error ? err.message : err);
    }
  };

  // Defer past the response with after() so the write isn't dropped when the
  // serverless function suspends. Outside a request scope (e.g. a script)
  // after() throws — fall back to running immediately.
  try {
    after(run);
  } catch {
    run();
  }
}

/**
 * Fire-and-forget audit log entry for an action a person took.
 * Call after successful mutations — never blocks the response.
 */
export function logAudit(params: AuditParams): void {
  write(params.firmId, async () => {
    let name = params.performedByName;
    if (!name) {
      const { data } = await getServiceDbForFirm(params.firmId)
        .from('team')
        .select('name')
        .eq('person_id', params.performedBy)
        .single();
      name = data?.name ?? 'Unknown';
    }

    return {
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      entity_name: params.entityName ?? null,
      action: params.action,
      field_changed: params.fieldChanged ?? null,
      old_value: params.oldValue ?? null,
      new_value: params.newValue ?? null,
      performed_by: params.performedBy,
      performed_by_name: name,
      ip_address: params.ipAddress ?? null,
      actor_type: 'human',
    };
  });
}

/**
 * Fire-and-forget audit log entry for an action an agent took.
 *
 * Kept separate from logAudit so the call site has to say which it is —
 * agent work recorded as a lawyer's is exactly the failure this exists to
 * prevent. `performed_by` stays null for unattended runs.
 */
export function logAgentAudit(params: AgentAuditParams): void {
  write(params.firmId, async () => {
    let name = params.agentName;
    if (!name) {
      // `agents` is a global table — the raw client is correct here.
      const { data } = await getSupabase()
        .from('agents')
        .select('name')
        .eq('id', params.agentId)
        .maybeSingle();
      name = data?.name ?? params.agentId;
    }

    return {
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      entity_name: params.entityName ?? null,
      action: params.action,
      field_changed: params.fieldChanged ?? null,
      old_value: params.oldValue ?? null,
      new_value: params.newValue ?? null,
      performed_by: params.onBehalfOf ?? null,
      performed_by_name: name,
      ip_address: params.ipAddress ?? null,
      actor_type: 'agent',
      agent_id: params.agentId,
      agent_run_id: params.agentRunId ?? null,
    };
  });
}

/**
 * Fire-and-forget audit log entry for an action a platform operator took
 * against one firm.
 *
 * Kept separate from `logAudit` for the reason `logAgentAudit` is: the call
 * site has to say which kind of actor this was. An operator is not a staff
 * member (see lib/platform/auth.ts), so recording their work under `human`
 * would put a cross-tenant change in a firm's log under an actor kind that
 * cannot make one. `performed_by` carries the operator's `auth_user_id` rather
 * than a `team.person_id` — an operator has no person_id, and borrowing that
 * namespace would make an operator row indistinguishable from a staff row.
 *
 * ── Which firm ───────────────────────────────────────────────────────
 *
 * `audit_log.firm_id` is NOT NULL and the row is written through
 * `getServiceDbForFirm`, so an operator action must name a firm. The rule:
 *
 *   - an action that concerns one firm is logged against that firm. That is
 *     every per-firm operator action, and it is what puts "the platform
 *     operator did X to you" in the tenant's OWN audit log, readable through
 *     the firm's existing /admin audit-log surface. That property is the
 *     reason to reuse `audit_log` at all rather than open a platform-side
 *     table nobody's tenant can see.
 *   - an action that concerns several firms is logged once per firm, with
 *     {@link logOperatorAuditAcrossFirms}. Moving a domain from firm A to firm
 *     B is two rows, because it is genuinely two events and each tenant is
 *     entitled to its own.
 *
 * Rejected: a sentinel "platform" row in `firms` to hang firm-less rows on. It
 * would be a fake tenant that `forEachActiveFirm` enumerates and every cron
 * fans out to. Also rejected: making `firm_id` nullable — that is an unscoped
 * row in a tenant table, which is the invariant the conversion exists to hold.
 * A genuinely firm-less operator action therefore does not go here; today
 * there is exactly one (creating an operator, in
 * scripts/bootstrap-platform-operator.ts) and it is a script with a console
 * record, not a request.
 */
export function logOperatorAudit(params: OperatorAuditParams): void {
  write(params.firmId, async () => ({
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    entity_name: params.entityName ?? null,
    action: params.action,
    field_changed: params.fieldChanged ?? null,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    performed_by: params.operator.authUserId,
    performed_by_name: params.operator.name ?? params.operator.email,
    ip_address: params.ipAddress ?? null,
    actor_type: 'operator',
  }));
}

/**
 * The same operator action against each of several firms — one row per firm,
 * so no tenant's log is missing an event that touched it. See the "Which firm"
 * note on {@link logOperatorAudit}.
 */
export function logOperatorAuditAcrossFirms(
  firmIds: readonly string[],
  params: Omit<OperatorAuditParams, 'firmId'>,
): void {
  for (const firmId of firmIds) logOperatorAudit({ ...params, firmId });
}

/** Extract client IP from request headers */
export function getClientIP(req: Request): string {
  return (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()) ?? 'unknown';
}
