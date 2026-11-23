import { getRelationshipPartnerForMatter } from '@/lib/auth/relationship-partner';
import { getMostSeniorPartner, type MatterTeamMember } from '@/lib/queries/team-roles';

/**
 * Who reviews a Status Report for a matter: the relationship partner assigned
 * to the matter's client. The report goes to the client, so it is signed off by
 * the partner who owns that relationship — not by whoever happens to be the
 * most senior partner staffed on the matter.
 *
 * The relationship partner does not have to be on the matter team.
 *
 * Falls back to the most senior partner on the matter team when the client has
 * no relationship partner, or the assigned one has left. Without the fallback
 * the report would be created with no reviewer and route to nobody.
 */
export async function resolveStatusReportReviewer(
  matterId: string,
  team: MatterTeamMember[],
  firmId: string,
): Promise<{ personId: string; name: string | null } | null> {
  const rp = await getRelationshipPartnerForMatter(matterId, firmId);
  if (rp?.active) return { personId: rp.id, name: rp.name };

  const fallback = getMostSeniorPartner(team);
  console.warn(
    `[status-report] Matter ${matterId} has ${rp ? `an inactive relationship partner (${rp.id})` : 'no relationship partner'}` +
      ` — reviewer falls back to ${fallback ? `${fallback.name} (${fallback.position})` : 'nobody'}`,
  );
  return fallback ? { personId: fallback.personId, name: fallback.name } : null;
}
