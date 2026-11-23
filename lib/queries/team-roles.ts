import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

// Position seniority from most senior (0) to least senior
const SENIORITY_ORDER = [
  'Founding Partner',
  'Managing Partner',
  'Monitoring Partner',
  'Partner',
  'Of Counsel',
  'Senior Associate',
  'Mid-level Associate',
  'Junior Associate',
  'Underbar Associate',
] as const;

const PARTNER_POSITIONS = new Set(SENIORITY_ORDER.slice(0, 5));

export interface MatterTeamMember {
  personId: string;
  name: string;
  initials: string;
  position: string;
  seniorityRank: number;
}

function getSeniorityRank(position: string): number {
  const idx = SENIORITY_ORDER.indexOf(position as typeof SENIORITY_ORDER[number]);
  return idx >= 0 ? idx : SENIORITY_ORDER.length; // unknown positions rank last
}

/**
 * Get all team members for a matter, sorted by seniority (most senior first).
 */
export async function getMatterTeamByRole(firmId: string, matterId: string): Promise<MatterTeamMember[]> {
  const supabase = getServiceDbForFirm(firmId);

  // Get team_person_ids from the matter
  const { data: matter, error: mErr } = await supabase
    .from('matters')
    .select('team_person_ids')
    .eq('notion_id', matterId)
    .single();

  if (mErr || !matter) return [];

  const personIds: string[] = matter.team_person_ids ?? [];
  if (personIds.length === 0) return [];

  // Look up team for those person_ids
  const { data: lawyers, error: lErr } = await supabase
    .from('team')
    .select('person_id, name, initials, position')
    .in('person_id', personIds)
    .eq('active', true);

  if (lErr || !lawyers) return [];

  return lawyers
    .map((l: { person_id: string; name: string; initials: string; position: string }) => ({
      personId: l.person_id,
      name: l.name,
      initials: l.initials,
      position: l.position,
      seniorityRank: getSeniorityRank(l.position),
    }))
    .sort((a, b) => a.seniorityRank - b.seniorityRank);
}

/** Most senior partner in the team (Founding > Managing > ... > Of Counsel) */
export function getMostSeniorPartner(members: MatterTeamMember[]): MatterTeamMember | null {
  return members.find((m) => PARTNER_POSITIONS.has(m.position as typeof SENIORITY_ORDER[number])) ?? null;
}

/** Junior associates (lowest seniority among associates) */
export function getJuniorAssociates(members: MatterTeamMember[]): MatterTeamMember[] {
  const associates = members.filter((m) => !PARTNER_POSITIONS.has(m.position as typeof SENIORITY_ORDER[number]));
  if (associates.length === 0) return [];
  // Get all with the lowest rank (highest seniorityRank number)
  const lowestRank = Math.max(...associates.map((a) => a.seniorityRank));
  return associates.filter((a) => a.seniorityRank === lowestRank);
}

/** Mid-level or senior associate (for initial reviewer role) */
export function getMidSeniorAssociate(members: MatterTeamMember[]): MatterTeamMember | null {
  const associates = members.filter((m) => !PARTNER_POSITIONS.has(m.position as typeof SENIORITY_ORDER[number]));
  if (associates.length <= 1) return null;
  // Return the most senior associate (lowest seniorityRank among associates)
  return associates[0] ?? null;
}
