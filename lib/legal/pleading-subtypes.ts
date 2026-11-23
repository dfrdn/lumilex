// The deliverable subtypes Red Team is built for. The taxonomy it applies —
// threshold defects, prescription, missing elements, demurrer exposure — is
// litigation-shaped, so contracts, proposals and notices are deliberately out.
//
// Judicial affidavits are excluded on purpose: Affidavit Review already covers
// them with a per-question objection analysis that is the better tool.
export const RED_TEAM_SUBTYPES = [
  'Complaint',
  'Answer',
  'Reply',
  'Motion',
  'Comment/Opposition',
  'Position Paper',
  'Memorandum',
  'Manifestation',
  'Petition',
  'Pre-Trial Brief',
] as const;

// Legacy rows predate `deliverables.subtype` and carry the document type only
// in their name, so fall back to matching that.
const NAME_PATTERN =
  /\b(complaint|answer|reply|motion|opposition|position paper|memorandum|manifestation|petition|pre-?trial brief)\b/i;

// The name alone is not enough. A status report names the pleading it reports
// on ("Status Report — Filing of Motion for Extension"), so matching on name
// only would offer Red Team for 227 status reports and 49 client letters across
// the firm's untagged rows — measured, not guessed. `deliverables.type` is the
// reliable discriminator for those rows, so the fallback is gated on it.
const NAME_FALLBACK_TYPES = ['External', 'Pleading'];

/**
 * Whether Red Team should be offered for a deliverable. `subtype` decides when
 * it is set; otherwise the row is legacy and both its type and its name have to
 * look like a pleading.
 */
export function isRedTeamable(
  subtype: string | null | undefined,
  name: string | null | undefined,
  type?: string | null,
): boolean {
  const st = (subtype ?? '').trim();
  if (st) return (RED_TEAM_SUBTYPES as readonly string[]).includes(st);
  if (!NAME_FALLBACK_TYPES.includes((type ?? '').trim())) return false;
  return NAME_PATTERN.test(name ?? '');
}

// Subtypes that exist only as an answer to something already filed. A Position
// Paper or Memorandum is usually filed on a schedule rather than in response to
// a specific pleading, so neither is included — the lawyer can still attach a
// target on those, this only decides whether the field opens by itself.
const RESPONSIVE_SUBTYPES = ['Answer', 'Reply', 'Comment/Opposition'];

const RESPONSIVE_NAME_PATTERN =
  /\b(answer|reply|rejoinder|comment|opposition|counter-affidavit|oppos\w*)\b/i;

/**
 * Whether a deliverable reads as responsive, so the Red Team form can offer the
 * pleading it answers without being asked. A false positive costs an expanded
 * optional field; a false negative costs a lawyer noticing the field exists.
 */
export function isResponsivePleading(
  subtype: string | null | undefined,
  name: string | null | undefined,
): boolean {
  const st = (subtype ?? '').trim();
  if (st) return RESPONSIVE_SUBTYPES.includes(st);
  return RESPONSIVE_NAME_PATTERN.test(name ?? '');
}
