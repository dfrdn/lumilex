import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type { DropdownOption } from '@/components/admin/CellDropdown';

export interface PersonInfo {
  personId: string;
  initials: string;
  position: string;
  avatarUrl: string | null;
  active: boolean;
}

export interface TeamMemberOption {
  personId: string;
  name: string;
  initials: string;
  position: string;
  avatarUrl: string | null;
  role: string;
}

/** Roles that can carry legal work — drafting, reviewing, matter assignment. */
export const LAWYER_ROLES = ['lawyer', 'partner', 'super_user'] as const;

/** Roles eligible to be a client's relationship partner — partners only (super_user is the dev/name-partner escape hatch). */
export const PARTNER_ROLES = ['partner', 'super_user'] as const;

export interface PartnerPickerData {
  /** Selectable partners: active team members whose role is in PARTNER_ROLES. */
  options: DropdownOption[];
  /**
   * person_id → display name for EVERY team member (any role, active or not).
   * Lets the UI resolve a client's stored relationship partner even after that
   * person goes inactive or changes role — the id would otherwise be missing
   * from `options` and render as unassigned.
   */
  nameById: Record<string, string>;
}

/**
 * One team-table read that powers the relationship-partner picker: the selectable
 * (active partner) options plus a full name map so an already-assigned partner who
 * is no longer selectable still renders by name. Keeps the picker's label, the
 * list's sort/filter name, and the stored id resolving from a single source.
 */
export async function getPartnerPickerData(firmId: string): Promise<PartnerPickerData> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('team')
    .select('person_id, name, initials, position, avatar_url, role, active')
    .order('name');
  if (error) throw error;
  const rows = data ?? [];

  const options: DropdownOption[] = rows
    .filter((r) => r.active && (PARTNER_ROLES as readonly string[]).includes(r.role))
    .map((r) => ({
      id: r.person_id,
      label: r.name,
      sublabel: r.position || '',
      initials: r.initials || '??',
      avatarUrl: r.avatar_url || null,
    }));

  const nameById: Record<string, string> = {};
  for (const r of rows) nameById[r.person_id] = r.name;

  return { options, nameById };
}

/**
 * Filters an array of person IDs down to those whose `team.active` is true.
 * Used by auto-derive flows (matter team → drafters/attendees/etc.) so an
 * inactive teammate who lingers on `matter.team_person_ids` does not get
 * carried forward onto new deliverables, hearings, meetings, or status
 * reports. Preserves input order.
 */
export async function filterActivePersonIds(firmId: string, personIds: string[]): Promise<string[]> {
  if (!personIds || personIds.length === 0) return [];
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('team')
    .select('person_id')
    .in('person_id', personIds)
    .eq('active', true);
  if (error) throw error;
  const activeSet = new Set((data ?? []).map((r) => r.person_id));
  return personIds.filter((id) => activeSet.has(id));
}

/** Positions considered "junior associates" for drafter auto-derive rules. */
export const JUNIOR_ASSOCIATE_POSITIONS = ['Junior Associate', 'Underbar Associate'] as const;

/**
 * Filters an array of person IDs down to active team members whose position
 * is `Junior Associate` or `Underbar Associate`. Status Report drafters are
 * limited to junior associates by firm convention — partners and senior
 * associates review, juniors draft. Preserves input order.
 */
export async function filterToJuniorAssociates(firmId: string, personIds: string[]): Promise<string[]> {
  if (!personIds || personIds.length === 0) return [];
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('team')
    .select('person_id')
    .in('person_id', personIds)
    .eq('active', true)
    .in('position', JUNIOR_ASSOCIATE_POSITIONS as unknown as string[]);
  if (error) throw error;
  const allowed = new Set((data ?? []).map((r) => r.person_id));
  return personIds.filter((id) => allowed.has(id));
}

/**
 * Returns all active team members for use in pickers/dropdowns.
 */
export async function getActiveTeamMembers(firmId: string): Promise<TeamMemberOption[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('team')
    .select('person_id, name, initials, position, avatar_url, role')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    personId: row.person_id,
    name: row.name,
    initials: row.initials || '??',
    position: row.position || '',
    avatarUrl: row.avatar_url || null,
    role: row.role || '',
  }));
}

/**
 * Resolves an array of person_ids to their initials from team.
 * Returns a Map<personId, PersonInfo> for O(1) lookups.
 */
export async function resolvePersonIds(firmId: string, 
  personIds: string[],
): Promise<Map<string, PersonInfo>> {
  const unique = [...new Set(personIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('team')
    .select('person_id, initials, position, avatar_url, active')
    .in('person_id', unique);

  if (error) throw error;

  const map = new Map<string, PersonInfo>();
  for (const row of data ?? []) {
    map.set(row.person_id, {
      personId: row.person_id,
      initials: row.initials || '??',
      position: row.position,
      avatarUrl: row.avatar_url || null,
      active: row.active ?? true,
    });
  }
  return map;
}

/**
 * Returns every team member (active + inactive) as a Map<personId, PersonInfo>.
 * Use as the base people map on detail pages so commenters/reactors who aren't
 * part of the matter still resolve to initials.
 */
export async function getAllTeamMembersAsMap(firmId: string): Promise<Map<string, PersonInfo>> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('team')
    .select('person_id, initials, position, avatar_url, active');
  if (error) throw error;
  const map = new Map<string, PersonInfo>();
  for (const row of data ?? []) {
    map.set(row.person_id, {
      personId: row.person_id,
      initials: row.initials || '??',
      position: row.position ?? '',
      avatarUrl: row.avatar_url || null,
      active: row.active ?? true,
    });
  }
  return map;
}

const currentTeams = new Map<string, { at: number; ids: Promise<Set<string>> }>();

/**
 * person_ids of a firm's active team members — the people who can be an
 * attendee, drafter or reviewer. Read at most once a minute per firm per
 * server instance: the work queries call it on every request, and the team
 * changes rarely.
 */
export function currentTeamIds(firmId: string): Promise<Set<string>> {
  const cached = currentTeams.get(firmId);
  if (cached && Date.now() - cached.at < 60_000) return cached.ids;
  const ids = (async () => {
    const { data, error } = await getServiceDbForFirm(firmId).from('team').select('person_id').eq('active', true);
    if (error) throw error;
    return new Set((data ?? []).map((r) => r.person_id as string));
  })();
  currentTeams.set(firmId, { at: Date.now(), ids });
  ids.catch(() => {
    if (currentTeams.get(firmId)?.ids === ids) currentTeams.delete(firmId);
  });
  return ids;
}

/**
 * Drops former members — inactive team rows and ids no team record knows —
 * from an attendee or drafter list. The stored row keeps them until the list
 * is next saved; a list edited from the page saves without them.
 */
export function currentOnly(ids: string[] | null | undefined, current: Set<string>): string[] {
  return (ids ?? []).filter((id) => current.has(id));
}

/**
 * The same for a deliverable's review chain, whose dates sit beside the
 * reviewers by position: a former reviewer's date goes with them.
 */
export function currentReviewers(
  ids: string[] | null | undefined,
  dates: (string | null)[] | null | undefined,
  current: Set<string>,
): { reviewerIds: string[]; reviewDates: (string | null)[] } {
  const reviewerIds: string[] = [];
  const reviewDates: (string | null)[] = [];
  (ids ?? []).forEach((id, i) => {
    if (!current.has(id)) return;
    reviewerIds.push(id);
    if (dates && i < dates.length) reviewDates.push(dates[i]);
  });
  return { reviewerIds, reviewDates };
}
