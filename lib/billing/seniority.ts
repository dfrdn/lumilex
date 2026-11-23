// Single source of truth for the firm's lawyer seniority order. Used for
// (a) sorting lawyer blocks in billing breakdowns (most senior first), and
// (b) cap-splitting retainer-bound DTRs so senior hours absorb the retainer
// before junior hours spill over into hourly excess.

export const SENIORITY_ORDER = [
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

export type SeniorPosition = (typeof SENIORITY_ORDER)[number];

/** Lower = more senior. Unknown positions sort last (treated as junior-most). */
export function getSeniorityRank(position: string | null | undefined): number {
  if (!position) return SENIORITY_ORDER.length;
  const idx = SENIORITY_ORDER.indexOf(position as SeniorPosition);
  return idx >= 0 ? idx : SENIORITY_ORDER.length;
}
