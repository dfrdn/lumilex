import type { SupabaseClient } from '@supabase/supabase-js';
import { logAudit } from '@/lib/audit';
import { manilaToday } from '@/lib/dates';
import { chunks, previewPortalCompany, type PortalCompanyDetail, type PortalSubjectType } from './companies';
import { previewPortalTrademark, type PortalMarkDetail } from './trademarks';

/**
 * Who may show a company or mark in the client portal, and whether it is ready
 * to be shown (D19).
 *
 * A partner or admin may switch any subject; a lawyer only one on their team,
 * meaning on the team of a matter that covers it or of any matter of its
 * client. Finance and liaison may not, on a team or off it. Switching off goes
 * through the same gate. Switching on also needs a client with an active
 * portal user, and that this person has just looked at what the client will
 * see.
 *
 * Every read and the write run on the service client, after the route has
 * checked the record with the caller's JWT. `guard_portal_visible` refuses the
 * column to any JWT, so this module is the only way to change it.
 */

const SUBJECT: Record<PortalSubjectType, { table: string; entityType: string; noun: string; columns: string }> = {
  corporation: {
    table: 'corporations',
    entityType: 'Corporation',
    noun: 'company',
    columns: 'approved_name, proposed_names, portal_visible, client_id, engaging_client_id',
  },
  trademark: { table: 'trademarks', entityType: 'Trademark', noun: 'mark', columns: 'mark, portal_visible, client_id' },
};

/** The audit action that records someone opening the readiness preview. */
export const PORTAL_PREVIEW_ACTION = 'portal_preview_viewed';

/** The audit actions that record the switch itself. */
export const PORTAL_SHOWN_ACTION = 'portal_shown';
export const PORTAL_HIDDEN_ACTION = 'portal_hidden';

/** The refusal code for a switch-on with no recent preview; the page reopens the preview on it. */
export const PORTAL_PREVIEW_REQUIRED = 'portal_preview_required';

/** How long opening the preview counts as having seen it. */
const PREVIEW_GOOD_FOR_MS = 30 * 60 * 1000;

export interface Switcher {
  firmId: string;
  personId: string;
  role: string | null | undefined;
}

export interface SwitchRefusal {
  ok: false;
  status: number;
  code: string;
  error: string;
}

export interface PortalSwitchAudience {
  clientId: string;
  clientName: string;
  activeUsers: number;
  detail: PortalCompanyDetail | PortalMarkDetail;
}

export interface PortalSwitchPreview {
  ready: boolean;
  blockers: string[];
  audiences: PortalSwitchAudience[];
  today: string;
}

/** `any` subject, only subjects on the person's `team`, or `none` at all. */
export function switchTier(role: string | null | undefined): 'any' | 'team' | 'none' {
  if (role === 'admin' || role === 'super_user' || role === 'partner') return 'any';
  return role === 'lawyer' ? 'team' : 'none';
}

/**
 * The switch asked for by a PATCH body, or null when the body doesn't touch
 * it. It travels alone, so a refused switch can't leave other edits half saved.
 */
export function parsePortalSwitch(body: Record<string, unknown>): { visible: boolean } | { error: string } | null {
  const key = 'portalVisible' in body ? 'portalVisible' : 'portal_visible' in body ? 'portal_visible' : null;
  if (!key) return null;
  if (typeof body[key] !== 'boolean') return { error: 'portalVisible must be true or false' };
  if (Object.keys(body).length > 1) return { error: 'portalVisible is changed on its own' };
  return { visible: body[key] as boolean };
}

/** What stands between this subject and the portal, in words for the person switching it. */
export function readinessBlockers(
  noun: string,
  counts: { coveringClients: number; activeUsers: number; previews: number },
): string[] {
  if (counts.coveringClients === 0) return [`No client's matter covers this ${noun}, so it would not appear in any portal. Link the matter first.`];
  const blockers: string[] = [];
  if (counts.activeUsers === 0) blockers.push('The client has no active portal user yet. Invite one first.');
  if (counts.previews === 0) blockers.push(`This ${noun}'s status has not been worked out yet. Try again in a few minutes.`);
  return blockers;
}

/** A failed read is not an empty one: it must not come back as "no portal user" or "not on the team". */
class CheckFailed extends Error {}

function checked<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new CheckFailed(error.message);
  return data;
}

async function refusingOnFailedCheck<T>(work: () => Promise<T>): Promise<T | SwitchRefusal> {
  try {
    return await work();
  } catch (err) {
    if (!(err instanceof CheckFailed)) throw err;
    console.error('[portal switch] read failed:', err.message);
    return { ok: false, status: 503, code: 'portal_check_failed', error: 'Could not check this just now. Try again.' };
  }
}

interface SubjectFacts {
  name: string | null;
  visible: boolean;
  matterIds: string[];
  /** The clients whose portals would show it: those whose matters cover it. */
  coveringClientIds: string[];
  /** Those, and the client named on the record itself. */
  clientIds: string[];
}

async function loadFacts(db: SupabaseClient, kind: PortalSubjectType, id: string): Promise<SubjectFacts | null> {
  const data = checked(await db.from(SUBJECT[kind].table).select(SUBJECT[kind].columns).eq('id', id).maybeSingle());
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;

  const links = checked(await db.from('matter_subjects').select('matter_id').eq('subject_id', id));
  const matterIds = [...new Set((links ?? []).map((l) => l.matter_id as string))];
  const batches = await Promise.all(chunks(matterIds).map((ids) => db.from('matters').select('client_id').in('notion_id', ids)));
  const coveringClientIds = [
    ...new Set(batches.flatMap((batch) => (checked(batch) ?? []).map((m) => m.client_id as string | null)).filter((c): c is string => !!c)),
  ];
  const own = [row.client_id, row.engaging_client_id].filter((c): c is string => typeof c === 'string' && !!c);

  return {
    name: kind === 'corporation'
      ? (row.approved_name as string | null) ?? ((row.proposed_names as string[] | null) ?? [])[0] ?? null
      : (row.mark as string | null) ?? null,
    visible: !!row.portal_visible,
    matterIds,
    coveringClientIds,
    clientIds: [...new Set([...own, ...coveringClientIds])],
  };
}

async function onSubjectTeam(db: SupabaseClient, personId: string, facts: SubjectFacts): Promise<boolean> {
  const results = await Promise.all([
    ...chunks(facts.matterIds).map((ids) =>
      db.from('matters').select('notion_id').in('notion_id', ids).contains('team_person_ids', [personId]).limit(1)),
    ...chunks(facts.clientIds).flatMap((ids) => [
      db.from('matters').select('notion_id').in('client_id', ids).contains('team_person_ids', [personId]).limit(1),
      db.from('clients').select('notion_id').in('notion_id', ids).eq('relationship_partner_id', personId).limit(1),
    ]),
  ]);
  if (results.some(({ data }) => (data?.length ?? 0) > 0)) return true;
  results.forEach(checked);
  return false;
}

async function passesGate(db: SupabaseClient, who: Switcher, facts: SubjectFacts): Promise<boolean> {
  const tier = switchTier(who.role);
  return tier === 'any' || (tier === 'team' && onSubjectTeam(db, who.personId, facts));
}

function notFound(): SwitchRefusal {
  return { ok: false, status: 404, code: 'not_found', error: 'Not found' };
}

function notAllowed(kind: PortalSubjectType): SwitchRefusal {
  return {
    ok: false,
    status: 403,
    code: 'portal_switch_forbidden',
    error: `Only a lawyer on this ${SUBJECT[kind].noun}'s team, the client's relationship partner, a partner or an admin can change what the client sees.`,
  };
}

async function activeUsersByClient(db: SupabaseClient, clientIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const ids of chunks(clientIds)) {
    const data = checked(await db.from('client_users').select('client_id').in('client_id', ids).eq('active', true));
    for (const u of data ?? []) counts.set(u.client_id as string, (counts.get(u.client_id as string) ?? 0) + 1);
  }
  return counts;
}

async function clientNames(db: SupabaseClient, clientIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const ids of chunks(clientIds)) {
    const data = checked(await db.from('clients').select('notion_id, full_company_name, name, client_code').in('notion_id', ids));
    for (const c of data ?? []) {
      names.set(c.notion_id as string, c.full_company_name || c.name || (c.client_code ? `Client #${c.client_code}` : 'Client'));
    }
  }
  return names;
}

/** May this person change the switch? Decides whether the control is offered at all. */
export async function canSwitchPortal(
  db: SupabaseClient,
  kind: PortalSubjectType,
  id: string,
  who: Switcher,
): Promise<SwitchRefusal | { ok: true; canSwitch: boolean }> {
  return refusingOnFailedCheck(async () => {
    const facts = await loadFacts(db, kind, id);
    return { ok: true as const, canSwitch: !!facts && (await passesGate(db, who, facts)) };
  });
}

/**
 * Exactly what each covering client would see, and whether it can be shown.
 * Opening one that can be shown is recorded: `changePortalVisible` checks for
 * that record, so a preview with blockers never counts as seen.
 */
export async function portalSwitchPreview(
  db: SupabaseClient,
  kind: PortalSubjectType,
  id: string,
  who: Switcher,
  ipAddress?: string,
): Promise<SwitchRefusal | { ok: true; preview: PortalSwitchPreview }> {
  return refusingOnFailedCheck(async () => {
    const facts = await loadFacts(db, kind, id);
    if (!facts) return notFound();
    if (!(await passesGate(db, who, facts))) return notAllowed(kind);

    const [users, names] = await Promise.all([
      activeUsersByClient(db, facts.coveringClientIds),
      clientNames(db, facts.coveringClientIds),
    ]);
    const audiences: PortalSwitchAudience[] = [];
    for (const clientId of facts.coveringClientIds) {
      const detail = kind === 'corporation'
        ? await previewPortalCompany(db, clientId, id)
        : await previewPortalTrademark(db, clientId, id);
      if (detail) audiences.push({ clientId, clientName: names.get(clientId) ?? 'Client', activeUsers: users.get(clientId) ?? 0, detail });
    }
    audiences.sort((a, b) => Number(b.activeUsers > 0) - Number(a.activeUsers > 0));

    const blockers = readinessBlockers(SUBJECT[kind].noun, {
      coveringClients: facts.coveringClientIds.length,
      activeUsers: users.size,
      previews: audiences.length,
    });
    if (blockers.length === 0) {
      logAudit({
        firmId: who.firmId,
        entityType: SUBJECT[kind].entityType,
        entityId: id,
        entityName: facts.name ?? undefined,
        action: PORTAL_PREVIEW_ACTION,
        performedBy: who.personId,
        ipAddress,
      });
    }
    return { ok: true as const, preview: { ready: blockers.length === 0, blockers, audiences, today: manilaToday() } };
  });
}

async function viewedPreview(db: SupabaseClient, kind: PortalSubjectType, id: string, personId: string): Promise<boolean> {
  const data = checked(
    await db
      .from('audit_log')
      .select('id')
      .eq('entity_type', SUBJECT[kind].entityType)
      .eq('entity_id', id)
      .eq('action', PORTAL_PREVIEW_ACTION)
      .eq('performed_by', personId)
      .gte('created_at', new Date(Date.now() - PREVIEW_GOOD_FOR_MS).toISOString())
      .limit(1),
  );
  return (data?.length ?? 0) > 0;
}

/** Switch a company or mark on or off for the portal, if this person may and it is ready. */
export async function changePortalVisible(
  db: SupabaseClient,
  kind: PortalSubjectType,
  id: string,
  visible: boolean,
  who: Switcher,
  ipAddress?: string,
): Promise<SwitchRefusal | { ok: true }> {
  return refusingOnFailedCheck(async () => {
    const facts = await loadFacts(db, kind, id);
    if (!facts) return notFound();
    if (!(await passesGate(db, who, facts))) return notAllowed(kind);
    if (facts.visible === visible) return { ok: true as const };

    if (visible) {
      const users = await activeUsersByClient(db, facts.coveringClientIds);
      if (users.size === 0) {
        return { ok: false as const, status: 409, code: 'portal_not_ready', error: 'The client has no active portal user yet. Invite one first.' };
      }
      if (!(await viewedPreview(db, kind, id, who.personId))) {
        return { ok: false as const, status: 409, code: PORTAL_PREVIEW_REQUIRED, error: 'Open the preview of what the client will see first.' };
      }
    }

    const { error } = await db
      .from(SUBJECT[kind].table)
      .update({ portal_visible: visible, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('[portal switch] update failed:', error.message);
      return { ok: false as const, status: 500, code: 'portal_switch_failed', error: 'Could not change portal visibility.' };
    }

    logAudit({
      firmId: who.firmId,
      entityType: SUBJECT[kind].entityType,
      entityId: id,
      entityName: facts.name ?? undefined,
      action: visible ? PORTAL_SHOWN_ACTION : PORTAL_HIDDEN_ACTION,
      fieldChanged: 'portal_visible',
      oldValue: String(facts.visible),
      newValue: String(visible),
      performedBy: who.personId,
      ipAddress,
    });
    return { ok: true as const };
  });
}
