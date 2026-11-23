// ── Court-level classification for the client portal ─────────────────
//
// `matters.court` is free text entered by the team ("RTC Branch 85, Quezon
// City", "OCP, Taguig City", "CA-Mindanao, Cagayan de Oro City", …). The
// portal groups matters by the level of the forum, so clients can see at a
// glance where each case sits in the Philippine judicial hierarchy. This is
// display-only bucketing — a miss lands in the generic "Government Agencies"
// bucket rather than misfiling into a court tier.

export type CourtLevelKey =
  | 'supreme_court'
  | 'appellate'
  | 'trial'
  | 'first_level'
  | 'prosecutor'
  | 'labor'
  | 'agency'
  | 'none';

export interface CourtLevel {
  key: CourtLevelKey;
  label: string;
  /** Hierarchy position — lower ranks render first (highest court on top). */
  rank: number;
}

export const COURT_LEVELS: Record<CourtLevelKey, CourtLevel> = {
  supreme_court: { key: 'supreme_court', label: 'Supreme Court', rank: 0 },
  appellate: { key: 'appellate', label: 'Appellate Courts', rank: 1 },
  trial: { key: 'trial', label: 'Regional Trial Courts', rank: 2 },
  first_level: { key: 'first_level', label: 'Municipal & Metropolitan Trial Courts', rank: 3 },
  prosecutor: { key: 'prosecutor', label: 'Prosecution & Investigation', rank: 4 },
  labor: { key: 'labor', label: 'Labor & Employment Tribunals', rank: 5 },
  agency: { key: 'agency', label: 'Government Agencies & Regulators', rank: 6 },
  none: { key: 'none', label: 'Advisory & Transactional Work', rank: 7 },
};

// Order matters: more specific hierarchies are tested before the catch-all
// agency bucket. Word-boundary regexes keep short acronyms ("CA", "FC") from
// matching inside longer tokens ("COA", "NCMB").
const RULES: Array<{ key: CourtLevelKey; pattern: RegExp }> = [
  { key: 'supreme_court', pattern: /supreme court|\bSC\b/i },
  {
    key: 'appellate',
    pattern: /court of appeals|\bCA\b|\bCA-[A-Za-z]+|court of tax appeals|\bCTA\b|sandiganbayan/i,
  },
  {
    key: 'labor',
    pattern: /\bNLRC\b|\bDOLE\b|\bNCMB\b|\bRCMB\b|labor arbiter|labor relations/i,
  },
  {
    key: 'prosecutor',
    pattern:
      /\bOCP\b|\bNPS\b|\bDOJ\b|prosecutor|department of justice|\bNBI\b|bureau of investigation|ombudsman/i,
  },
  {
    key: 'trial',
    pattern: /\bRTC\b|regional trial court|\bFC\b|family court/i,
  },
  {
    key: 'first_level',
    pattern: /\bMeTC\b|\bMTC\b|\bMTCC\b|\bMCTC\b|metropolitan trial|municipal trial|municipal circuit/i,
  },
];

export function classifyCourtLevel(court: string | null | undefined): CourtLevel {
  const text = (court ?? '').trim();
  if (!text) return COURT_LEVELS.none;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return COURT_LEVELS[rule.key];
  }
  return COURT_LEVELS.agency;
}
