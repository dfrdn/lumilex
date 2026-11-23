import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { forEachActiveFirm } from '@/lib/tenancy/fan-out';
import { createNotificationsBatch } from '@/lib/notifications';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { daysBetween, manilaToday, toManilaDay } from '@/lib/dates';
import { fetchAllRows, fetchAllRowsIn, idBatches } from '@/lib/supabase-paginate';

export const maxDuration = 300;

/**
 * POST /api/sla/evaluate
 *
 * Evaluates every active sla_rule against current deliverables. First
 * resolves each open breach that no longer holds (rule switched off,
 * deliverable closed, or the condition no longer met). Then, for each match
 * without an existing unresolved breach, inserts a sla_breaches row and
 * fires the rule's action (notify and/or reroute).
 *
 * Auth: CRON_SECRET via Authorization: Bearer header (the daily cron, 07:00
 *       Manila, fanned out per firm), OR
 *       admin/super_user session (manual kick from /admin/sla-rules).
 *
 * Returns { evaluated, resolved, newBreaches, errors, breaches: [...] }.
 */

interface RuleCondition {
  status?: string;
  idle_days_min?: number;
  due_date_lte_days?: number;
}

interface RuleAction {
  notify?: { roles?: string[]; persons?: string[] };
  reroute?: { append_role_to_currently_with?: string };
}

interface SlaRule {
  id: string;
  name: string;
  applies_to_matter_type: string | null;
  applies_to_deliverable_type: string | null;
  condition: RuleCondition;
  action: RuleAction;
}

interface DeliverableRow {
  notion_id: string;
  name: string;
  type: string | null;
  status: string | null;
  external_due_date: string | null;
  notion_last_edited_at: string | null;
  currently_with_ids: string[] | null;
  drafter_ids: string[] | null;
  matter_id: string | null;
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}

/**
 * `?dryRun=1` (same auth) writes nothing: no breach resolved or opened, no
 * reroute, no notification. It returns what a real run would do, the open
 * breaches it would resolve included, so a first run can be checked first.
 */
function isDryRun(req: Request): boolean {
  const v = new URL(req.url).searchParams.get('dryRun');
  return v === '1' || v === 'true';
}

async function handle(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  // The cron path fans out across every active firm; an admin session
  // evaluates their firm only.
  let sessionFirmId: string | null = null;
  if (!isCron) {
    const session = await getSession();
    const role = session?.user?.role ?? 'lawyer';
    if (!session || !['admin', 'super_user'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    sessionFirmId = session.firmId;
  }

  if (sessionFirmId) {
    return NextResponse.json(await evaluateForFirm(getServiceDbForFirm(sessionFirmId), sessionFirmId, isDryRun(req)));
  }

  const firms = await forEachActiveFirm(({ firm, db }) => evaluateForFirm(db, firm.id, isDryRun(req)));
  return NextResponse.json({
    evaluated: firms.reduce((n, f) => n + (f.result?.evaluated ?? 0), 0),
    resolved: firms.reduce((n, f) => n + (f.result?.resolved ?? 0), 0),
    dryRun: isDryRun(req),
    newBreaches: firms.reduce((n, f) => n + (f.result?.newBreaches ?? 0), 0),
    errors: firms.reduce((n, f) => n + (f.result?.errors ?? 0), 0),
    breaches: firms.flatMap((f) => f.result?.breaches ?? []),
    firms: firms.map(({ firmId, slug, ok, error }) => ({ firmId, slug, ok, error })),
  });
}

type EvaluateResult = {
  evaluated: number;
  resolved: number;
  dryRun: boolean;
  resolvedBreaches: { id: string; rule: string | null; deliverableId: string; reason: string }[];
  newBreaches: number;
  errors: number;
  breaches: { rule: string; deliverable: string; breachType: string; rerouted: string[]; notified: string[] }[];
};

async function evaluateForFirm(supabase: SupabaseClient, firmId: string, dryRun = false): Promise<EvaluateResult> {
  const today = new Date();
  const todayIso = manilaToday(today);

  // Active rules.
  const { data: rules, error: ruleErr } = await supabase
    .from('sla_rules')
    .select('id, name, applies_to_matter_type, applies_to_deliverable_type, condition, action')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (ruleErr) throw new Error(ruleErr.message);

  // Every read below must be complete: the resolve step closes any open
  // breach whose deliverable or matter type it can't see, so a truncated or
  // failed read would close live breaches. Paged, batched, and fatal on error.
  let deliverables: DeliverableRow[];
  let matterTypeMap: Map<string, string>;
  let openBreaches: { id: string; deliverable_id: string; rule_id: string }[];
  try {
    // Active deliverables only (skip terminal statuses).
    deliverables = await fetchAllRows<DeliverableRow>((from, to) =>
      supabase
        .from('deliverables')
        .select('notion_id, name, type, status, external_due_date, notion_last_edited_at, currently_with_ids, drafter_ids, matter_id')
        .not('status', 'in', pgInList(CLOSED_STATUSES))
        .order('notion_id')
        .range(from, to),
    );

    // Matter type lookup for the rule filter.
    const matterIds = [...new Set(deliverables.map((d) => d.matter_id).filter((id): id is string => !!id))];
    const matters = await fetchAllRowsIn<{ notion_id: string; type: string | null }>(matterIds, (batch, from, to) =>
      supabase.from('matters').select('notion_id, type').in('notion_id', batch).order('notion_id').range(from, to),
    );
    matterTypeMap = new Map(matters.map((m) => [m.notion_id, m.type ?? '']));

    // Existing unresolved breaches: resolve the ones that no longer hold, and
    // dedup new matches against the rest.
    openBreaches = await fetchAllRows<{ id: string; deliverable_id: string; rule_id: string }>((from, to) =>
      supabase.from('sla_breaches').select('id, deliverable_id, rule_id').is('resolved_at', null).order('id').range(from, to),
    );
  } catch (err) {
    // Stop this firm's run: the fan-out records it as failed.
    throw new Error(err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Read failed');
  }

  const ruleById = new Map(((rules ?? []) as SlaRule[]).map((r) => [r.id, r]));
  const openDeliverables = new Map(deliverables.map((d) => [d.notion_id, d]));
  const stale = openBreaches.filter((b) => {
    const rule = ruleById.get(b.rule_id);
    const d = openDeliverables.get(b.deliverable_id);
    return !rule || !d || !matches(rule, d, matterTypeMap, todayIso);
  });
  const resolvedAt = new Date().toISOString();
  let resolved = dryRun ? stale.length : 0;
  for (const batch of dryRun ? [] : idBatches(stale.map((b) => b.id))) {
    const { error: resErr } = await supabase
      .from('sla_breaches')
      .update({ resolved_at: resolvedAt })
      .in('id', batch)
      .is('resolved_at', null);
    if (resErr) throw new Error(resErr.message);
    resolved += batch.length;
  }
  const staleIds = new Set(stale.map((b) => b.id));
  const openSet = new Set(
    openBreaches
      .filter((b) => !staleIds.has(b.id))
      .map((b) => `${b.deliverable_id}::${b.rule_id}`),
  );

  // Team lookup for role → person_id resolution.
  const { data: teamRows } = await supabase
    .from('team')
    .select('person_id, email, role')
    .eq('active', true);
  const teamMembers = (teamRows ?? []) as { person_id: string | null; email: string | null; role: string | null }[];

  const newBreaches: { rule: string; deliverable: string; breachType: string; rerouted: string[]; notified: string[] }[] = [];
  let evaluated = 0;
  let errors = 0;

  for (const rule of (rules ?? []) as SlaRule[]) {
    for (const d of deliverables) {
      evaluated++;
      if (!matches(rule, d, matterTypeMap, todayIso)) continue;
      const key = `${d.notion_id}::${rule.id}`;
      if (openSet.has(key)) continue;

      const breachType = inferBreachType(rule, d, todayIso);
      const action = rule.action ?? {};
      const recipientPersonIds = resolveNotifyRecipients(action, d, teamMembers);
      const rerouteAppendIds = resolveRerouteAppend(action, teamMembers);
      const current = d.currently_with_ids ?? [];
      const toAdd = rerouteAppendIds.filter((id) => !current.includes(id));

      // Insert the breach FIRST — it's both the audit record and the dedup
      // guard. The partial unique index (deliverable_id, rule_id) WHERE
      // resolved_at IS NULL rejects a second *open* breach (23505) but allows
      // re-firing once a prior breach is resolved. Recording it before the
      // reroute guarantees we never mutate currently_with_ids without an audit
      // row pointing back to the rule that did it.
      if (dryRun) {
        newBreaches.push({ rule: rule.name, deliverable: d.name, breachType, rerouted: toAdd, notified: recipientPersonIds });
        openSet.add(key);
        continue;
      }

      const { error: insErr } = await supabase
        .from('sla_breaches')
        .insert({
          deliverable_id: d.notion_id,
          rule_id: rule.id,
          breach_type: breachType,
          severity: severityFor(rule, d, todayIso),
          action_taken: {
            notified_persons: recipientPersonIds,
            rerouted_to: toAdd,
          },
        });
      if (insErr) {
        // 23505 = an open breach already exists (concurrent tick). Benign —
        // skip side-effects. Anything else is a real failure worth counting.
        if ((insErr as { code?: string }).code !== '23505') errors++;
        continue;
      }

      // Reroute only after the breach is recorded.
      if (toAdd.length > 0) {
        await supabase
          .from('deliverables')
          .update({ currently_with_ids: [...current, ...toAdd] })
          .eq('notion_id', d.notion_id);
      }

      // Notifications respect notify_sla_breach opt-out.
      if (recipientPersonIds.length > 0) {
        const optedOut = await loadOptedOutPersons(supabase, recipientPersonIds, teamMembers);
        const finalRecipients = recipientPersonIds.filter((p) => !optedOut.has(p));
        if (finalRecipients.length > 0) {
          await createNotificationsBatch(
            finalRecipients.map((person_id) => ({
              person_id,
              type: 'sla_breach' as const,
              title: `SLA: ${rule.name}`,
              body: `${d.name} triggered "${rule.name}".`,
              href: `/dashboard/deliverables/${d.notion_id}`,
              entity_id: d.notion_id,
            })),
            firmId,
          );
        }
      }

      newBreaches.push({
        rule: rule.name,
        deliverable: d.name,
        breachType,
        rerouted: toAdd,
        notified: recipientPersonIds,
      });
      // Cache so a later rule that would create the same breach skips.
      openSet.add(key);
    }
  }

  return {
    evaluated,
    resolved,
    dryRun,
    resolvedBreaches: stale.map((b) => ({
      id: b.id,
      rule: ruleById.get(b.rule_id)?.name ?? null,
      deliverableId: b.deliverable_id,
      reason: !ruleById.has(b.rule_id) ? 'rule inactive' : !openDeliverables.has(b.deliverable_id) ? 'deliverable closed' : 'no longer matches',
    })),
    newBreaches: newBreaches.length,
    errors,
    breaches: newBreaches,
  };
}

// ── Rule evaluation ──────────────────────────────────────────────────

/**
 * Whole calendar days between two instants, anchored to UTC midnight of each
 * one's date. Stable regardless of time-of-day, so SLA thresholds don't flip
 * by ±1 depending on what hour the cron happens to fire.
 */
function matches(
  rule: SlaRule,
  d: DeliverableRow,
  matterTypeMap: Map<string, string>,
  todayIso: string,
): boolean {
  if (rule.applies_to_deliverable_type && d.type !== rule.applies_to_deliverable_type) return false;
  if (rule.applies_to_matter_type) {
    const mt = d.matter_id ? matterTypeMap.get(d.matter_id) : '';
    if (mt !== rule.applies_to_matter_type) return false;
  }

  const c = rule.condition ?? {};
  if (c.status && d.status !== c.status) return false;

  if (typeof c.idle_days_min === 'number') {
    const editedMs = d.notion_last_edited_at ? new Date(d.notion_last_edited_at).getTime() : null;
    if (editedMs == null || Number.isNaN(editedMs)) return false;
    const idleDays = daysBetween(toManilaDay(editedMs), todayIso);
    if (idleDays < c.idle_days_min) return false;
  }

  if (typeof c.due_date_lte_days === 'number') {
    if (!d.external_due_date) return false;
    const diffDays = daysBetween(todayIso, d.external_due_date);
    if (diffDays > c.due_date_lte_days) return false;
  }

  // At least one condition key must be satisfied — bare {} rule is a no-op.
  return Boolean(c.status || c.idle_days_min != null || c.due_date_lte_days != null);
}

function inferBreachType(rule: SlaRule, d: DeliverableRow, todayIso: string): string {
  if (d.external_due_date && d.external_due_date < todayIso) return 'overdue';
  if (rule.condition.idle_days_min != null) return 'idle';
  return 'status';
}

function severityFor(rule: SlaRule, d: DeliverableRow, todayIso: string): 'low' | 'normal' | 'high' {
  if (d.external_due_date && d.external_due_date < todayIso) {
    const overdueDays = daysBetween(d.external_due_date, todayIso);
    if (overdueDays > 14) return 'high';
  }
  if ((rule.condition.idle_days_min ?? 0) >= 14) return 'high';
  return 'normal';
}

// ── Recipient resolution ─────────────────────────────────────────────

function resolveNotifyRecipients(
  action: RuleAction,
  d: DeliverableRow,
  team: { person_id: string | null; role: string | null }[],
): string[] {
  // No notify clause → no notifications at all. This is what makes a
  // reroute-only or bare rule a true silent "dry run", matching the admin UI's
  // promise. Auto-including currently_with here would notify the drafter even
  // for rules the admin explicitly left notify-less.
  if (!action.notify) return [];

  const set = new Set<string>();
  const roles = action.notify.roles ?? [];
  if (roles.length > 0) {
    for (const t of team) {
      if (t.role && roles.includes(t.role) && t.person_id) set.add(t.person_id);
    }
  }
  for (const p of action.notify.persons ?? []) set.add(p);
  // When a rule does notify, also loop in the current handlers — if the partner
  // is being alerted, whoever holds the deliverable should know too.
  for (const p of d.currently_with_ids ?? []) set.add(p);
  return [...set];
}

function resolveRerouteAppend(
  action: RuleAction,
  team: { person_id: string | null; role: string | null }[],
): string[] {
  const role = action.reroute?.append_role_to_currently_with;
  if (!role) return [];
  const ids: string[] = [];
  for (const t of team) {
    if (t.role === role && t.person_id) ids.push(t.person_id);
  }
  return ids;
}

async function loadOptedOutPersons(
  supabase: SupabaseClient,
  personIds: string[],
  team: { person_id: string | null; email: string | null }[],
): Promise<Set<string>> {
  // person_id -> email lookup
  const emailByPerson = new Map<string, string>();
  for (const t of team) {
    if (t.person_id && t.email) emailByPerson.set(t.person_id, t.email);
  }
  const emails = personIds.map((p) => emailByPerson.get(p)).filter((e): e is string => !!e);
  if (emails.length === 0) return new Set();

  const { data } = await supabase
    .from('user_preferences')
    .select('email, notify_sla_breach')
    .in('email', emails);

  const optedOutEmails = new Set(
    (data ?? []).filter((p) => p.notify_sla_breach === false).map((p) => p.email),
  );

  const out = new Set<string>();
  for (const [pid, email] of emailByPerson) {
    if (optedOutEmails.has(email)) out.add(pid);
  }
  return out;
}
