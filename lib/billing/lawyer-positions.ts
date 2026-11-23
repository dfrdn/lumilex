import type { SupabaseClient } from '@supabase/supabase-js';

/** The shape every caller has in hand: a DTR row or snapshot, in either
 *  naming convention. Only the three fields below are read. */
export interface LawyerBearingRow {
  lawyerName?: string | null;
  lawyer_name?: string | null;
  lawyerPersonId?: string | null;
  lawyer_person_id?: string | null;
  withNames?: string[] | null;
  with_names?: string[] | null;
}

export interface LawyerPositions {
  /**
   * Position keyed by the name callers actually hold — which for a renamed
   * person is the STALE name on the DTR row, so entries under either spelling
   * price off the same team row.
   */
  positionByLawyerName: Record<string, string>;
  /** Initials keyed the same way, for the attendee suffix on a particulars line. */
  initialsByLawyerName: Record<string, string>;
  /** Current team name for a stale one, for display. Only renamed people appear. */
  currentNameByStaleName: Record<string, string>;
  /** Current display name for a row's author: the team row wins over the stored
   *  snapshot, so a stale copy still reads as the person. Falls back to the
   *  stored name when the author can't be resolved. */
  authorName: (row: LawyerBearingRow) => string;
  /** Names that matched no team row by either route. Their position can only be
   *  guessed, so a caller that bills must refuse rather than assume. */
  unresolved: string[];
}

const nameOf = (r: LawyerBearingRow) => r.lawyerName ?? r.lawyer_name ?? '';
const personIdOf = (r: LawyerBearingRow) => r.lawyerPersonId ?? r.lawyer_person_id ?? null;
const attendeesOf = (r: LawyerBearingRow) => r.withNames ?? r.with_names ?? [];

interface TeamRow { person_id: string; name: string; position: string | null; initials: string | null }
const TEAM_COLUMNS = 'person_id, name, position, initials';

/**
 * Resolves every lawyer on a set of DTR rows to their position — the one
 * implementation behind the invoice path (fetchBillingData), the Billing Review
 * preview (the bundle and clients routes) and billing efficiency.
 *
 * `lawyer_name` is a display snapshot written at insert time, so joining
 * `team` on it alone silently loses anyone who has been renamed — and a lost
 * lawyer has no position, which is what prices their hours. This resolves the
 * entry author by the stable `lawyer_person_id` as well, and registers the
 * position under the stale spelling too, so callers that key by name (every
 * one of them, since attendees only ever have names) keep working unchanged.
 *
 * Attendees still resolve by name: `with_names` has no id alongside it that
 * can be trusted to line up positionally. The rename cascade
 * (lib/team/cascade-rename.ts) is what keeps those fresh; `unresolved` is
 * what's left when both fail.
 *
 * `firmId` pins the team lookup even on a client whose own scoping is RLS.
 */
export async function resolveLawyerPositions(
  supabase: SupabaseClient,
  firmId: string,
  rows: LawyerBearingRow[],
): Promise<LawyerPositions> {
  const names = new Set<string>();
  const personIds = new Set<string>();
  for (const r of rows) {
    const n = nameOf(r);
    if (n) names.add(n);
    const pid = personIdOf(r);
    if (pid) personIds.add(pid);
    for (const a of attendeesOf(r)) if (a) names.add(a);
  }

  const [byName, byPersonId] = await Promise.all([
    names.size > 0
      ? supabase.from('team').select(TEAM_COLUMNS).eq('firm_id', firmId).in('name', [...names])
      : Promise.resolve({ data: [] as TeamRow[], error: null }),
    personIds.size > 0
      ? supabase.from('team').select(TEAM_COLUMNS).eq('firm_id', firmId).in('person_id', [...personIds])
      : Promise.resolve({ data: [] as TeamRow[], error: null }),
  ]);
  // A failed lookup would otherwise read as "nobody resolves" and price every
  // hour off a fallback.
  if (byName.error) throw new Error(`Failed to resolve lawyers by name: ${byName.error.message}`);
  if (byPersonId.error) throw new Error(`Failed to resolve lawyers by person: ${byPersonId.error.message}`);

  const positionByLawyerName: Record<string, string> = {};
  const initialsByLawyerName: Record<string, string> = {};
  const teamByPersonId = new Map<string, TeamRow>();
  for (const t of [...(byName.data ?? []), ...(byPersonId.data ?? [])] as TeamRow[]) {
    if (t.position) positionByLawyerName[t.name] = t.position;
    if (t.initials) initialsByLawyerName[t.name] = t.initials;
    teamByPersonId.set(t.person_id, t);
  }

  // Alias the stale spelling onto the person's real position.
  const currentNameByStaleName: Record<string, string> = {};
  for (const r of rows) {
    const pid = personIdOf(r);
    if (!pid) continue;
    const row = teamByPersonId.get(pid);
    const stale = nameOf(r);
    if (!row || !stale || stale === row.name) continue;
    if (row.position) positionByLawyerName[stale] = row.position;
    if (row.initials) initialsByLawyerName[stale] = row.initials;
    currentNameByStaleName[stale] = row.name;
  }

  const authorName = (row: LawyerBearingRow): string => {
    const pid = personIdOf(row);
    return (pid ? teamByPersonId.get(pid)?.name : undefined) ?? nameOf(row);
  };

  const unresolved = [...names].filter((n) => !positionByLawyerName[n]).sort();
  return { positionByLawyerName, initialsByLawyerName, currentNameByStaleName, unresolved, authorName };
}

/**
 * An attendee on a billable DTR entry who matches no `team` row. Their position
 * — and so their hourly rate — can only be guessed, and the guess is silent:
 * a renamed partner's hours fall through to the junior rate this way. Blocks
 * the bundle instead.
 */
export class UnresolvedLawyerError extends Error {
  constructor(readonly names: string[]) {
    super(
      `${names.length === 1 ? 'This name is' : 'These names are'} on billable time but match no team member: `
      + `${names.join(', ')}. Their position sets their hourly rate, so the bundle can't be priced. `
      + 'Fix the name on the DTR entry, or add the person under Admin → Users.',
    );
    this.name = 'UnresolvedLawyerError';
  }
}
