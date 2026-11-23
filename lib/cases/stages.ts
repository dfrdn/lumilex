/**
 * Where a proceeding stands inside its forum: the stages each kind of
 * proceeding goes through, which kind a proceeding is, and — for the
 * backfill — which stage its hearings say it has reached. Pure.
 */
import type { CourtLevel, ForumType, Relation } from './view';

export const TRACKS = [
  'preliminary_investigation',
  'petition_for_review',
  'criminal_trial',
  'civil_trial',
  'summary_procedure',
  'special_proceeding',
  'appellate',
  'labor',
  'administrative',
] as const;
export type Track = (typeof TRACKS)[number];

export interface Stage {
  key: string;
  label: string;
  /** Can be skipped without being missed (memoranda, a clarificatory hearing). */
  optional?: boolean;
}

const AFTER: Stage[] = [
  { key: 'reconsideration', label: 'MR period', optional: true },
  { key: 'execution', label: 'Execution', optional: true },
];

export const TRACK_LABEL: Record<Track, string> = {
  preliminary_investigation: 'Preliminary investigation',
  petition_for_review: 'Petition for review',
  criminal_trial: 'Criminal trial',
  civil_trial: 'Civil trial',
  summary_procedure: 'Summary procedure',
  special_proceeding: 'Special proceeding',
  appellate: 'Appeal or petition',
  labor: 'Labor case',
  administrative: 'Administrative case',
};

export const STAGES: Record<Track, Stage[]> = {
  preliminary_investigation: [
    { key: 'complaint_filed', label: 'Complaint filed' },
    { key: 'counter_affidavit', label: 'Counter-affidavit' },
    { key: 'reply_rejoinder', label: 'Reply / rejoinder', optional: true },
    { key: 'clarificatory', label: 'Clarificatory hearing', optional: true },
    { key: 'awaiting_resolution', label: 'Awaiting resolution' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'reconsideration', label: 'MR period', optional: true },
  ],
  petition_for_review: [
    { key: 'petition_filed', label: 'Petition filed' },
    { key: 'comment', label: 'Comment' },
    { key: 'awaiting_resolution', label: 'Awaiting resolution' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'reconsideration', label: 'MR period', optional: true },
  ],
  criminal_trial: [
    { key: 'arraignment', label: 'Arraignment' },
    { key: 'pre_trial', label: 'Pre-trial' },
    { key: 'prosecution_evidence', label: 'Prosecution evidence' },
    { key: 'defense_evidence', label: 'Defense evidence' },
    { key: 'memoranda', label: 'Memoranda', optional: true },
    { key: 'awaiting_decision', label: 'Awaiting decision' },
    { key: 'promulgation', label: 'Promulgation' },
    ...AFTER,
  ],
  civil_trial: [
    { key: 'pleadings', label: 'Pleadings' },
    { key: 'pre_trial', label: 'Pre-trial' },
    { key: 'plaintiff_evidence', label: "Plaintiff's evidence" },
    { key: 'defendant_evidence', label: "Defendant's evidence" },
    { key: 'memoranda', label: 'Memoranda', optional: true },
    { key: 'awaiting_decision', label: 'Awaiting decision' },
    { key: 'decision', label: 'Decision' },
    ...AFTER,
  ],
  summary_procedure: [
    { key: 'pleadings', label: 'Pleadings' },
    { key: 'preliminary_conference', label: 'Preliminary conference' },
    { key: 'position_papers', label: 'Position papers' },
    { key: 'awaiting_decision', label: 'Awaiting decision' },
    { key: 'decision', label: 'Decision' },
    ...AFTER,
  ],
  special_proceeding: [
    { key: 'petition_filed', label: 'Petition filed' },
    { key: 'jurisdictional_hearing', label: 'Jurisdictional hearing' },
    { key: 'petitioner_evidence', label: "Petitioner's evidence" },
    { key: 'opposition', label: 'Opposition', optional: true },
    { key: 'awaiting_decision', label: 'Awaiting decision' },
    { key: 'decision', label: 'Decision' },
    { key: 'reconsideration', label: 'MR period', optional: true },
  ],
  appellate: [
    { key: 'filed', label: 'Filed' },
    { key: 'comment_briefs', label: 'Comment or briefs' },
    { key: 'memoranda', label: 'Memoranda', optional: true },
    { key: 'awaiting_decision', label: 'Awaiting decision' },
    { key: 'decision', label: 'Decision' },
    { key: 'reconsideration', label: 'MR period', optional: true },
  ],
  labor: [
    { key: 'conciliation', label: 'Conciliation-mediation' },
    { key: 'position_papers', label: 'Position papers' },
    { key: 'replies', label: 'Replies', optional: true },
    { key: 'clarificatory', label: 'Clarificatory conference', optional: true },
    { key: 'awaiting_decision', label: 'Awaiting decision' },
    { key: 'decision', label: 'Decision' },
    ...AFTER,
  ],
  administrative: [
    { key: 'complaint_filed', label: 'Complaint filed' },
    { key: 'answer', label: 'Answer' },
    { key: 'hearing', label: 'Hearing or conference', optional: true },
    { key: 'position_papers', label: 'Position papers / memoranda' },
    { key: 'awaiting_resolution', label: 'Awaiting resolution' },
    { key: 'resolved', label: 'Resolved' },
    ...AFTER,
  ],
};

/** The stage a resolved proceeding sits at: its decision or resolution. */
export function finalStage(track: Track): string {
  const s = STAGES[track];
  return [...s].reverse().find((x) => !x.optional)!.key;
}

const SUMMARY = /unlawful detainer|forcible entry|ejectment|small claim/i;
const SPECIAL = /\bsp\b|sp\.?\s*proc|special proceeding|^in re\b|^in the matter|guardianship|adoption|cancellation of (certificate|birth|entr)|correction of entr|habeas|declaration of (presumptive )?death/i;
const CRIMINAL = /\bcrim|criminal|-cr\b|\bcr\b/i;

/**
 * Which kind of proceeding this is, read from its forum, how it came from its
 * parent, its docket, caption and what the case is about. A lawyer can change it.
 */
export function detectTrack(p: {
  forumType: ForumType;
  courtLevel: CourtLevel | null;
  relation: Relation;
  docketNo: string | null;
  caption: string;
  nature: string | null;
}): Track {
  if (p.forumType === 'doj' || p.relation === 'review') return 'petition_for_review';
  if (p.forumType === 'prosecutor' || p.forumType === 'ombudsman' || p.forumType === 'law_enforcement') return 'preliminary_investigation';
  if (p.forumType === 'labor') return 'labor';
  if (p.forumType === 'agency' || p.forumType === 'unknown') return 'administrative';
  if (p.courtLevel === 'ca' || p.courtLevel === 'sc' || ['appeal', 'rule_45', 'rule_65'].includes(p.relation)) return 'appellate';
  const docket = p.docketNo ?? '';
  const text = `${p.caption} ${p.nature ?? ''}`;
  if (/^people\b/i.test(p.caption) || CRIMINAL.test(docket) || p.relation === 'information') return 'criminal_trial';
  if (SPECIAL.test(docket) || SPECIAL.test(text)) return 'special_proceeding';
  if (SUMMARY.test(text)) return 'summary_procedure';
  return 'civil_trial';
}

/**
 * The stage a hearing's name points to on a track, or null for settings that
 * don't move a case along (a motion hearing, a monitoring hearing).
 */
export function stageOfHearing(track: Track, name: string): string | null {
  const n = name.toLowerCase();
  const has = (key: string) => STAGES[track].some((s) => s.key === key);
  const pick = (...keys: string[]) => keys.find(has) ?? null;
  if (/motion hearing|monitor|compliance|status conference|initial hearing$/.test(n)) return null;
  if (/pre-?execution|execution/.test(n)) return pick('execution');
  if (/promulgation/.test(n)) return pick('promulgation', 'decision');
  if (/memorand/.test(n)) return pick('memoranda', 'position_papers');
  // Before "position paper": a reply to one is the replies stage.
  if (/\breply\b|rejoinder/.test(n)) return pick('replies', 'reply_rejoinder', 'position_papers');
  if (/position paper/.test(n)) return pick('position_papers');
  if (/clarificatory/.test(n)) return pick('clarificatory', 'hearing');
  if (/jurisdictional/.test(n)) return pick('jurisdictional_hearing');
  if (/opposition/.test(n)) return pick('opposition');
  if (/preliminary conference/.test(n)) return pick('preliminary_conference', 'pre_trial', 'hearing');
  if (/defen[cs]e|defendant|respondent'?s evidence/.test(n)) return pick('defense_evidence', 'defendant_evidence');
  if (/prosecution|complainant/.test(n)) return pick('prosecution_evidence');
  if (/plaintiff/.test(n)) return pick('plaintiff_evidence');
  if (/petitioner/.test(n)) return pick('petitioner_evidence');
  if (/pre-?trial|pre-?marking|marking of|mediation|\bjdr\b|judicial dispute|conciliation/.test(n)) return pick('pre_trial', 'conciliation', 'preliminary_conference', 'hearing');
  if (/arraign/.test(n)) return pick('arraignment');
  if (/presentation|reception|witness|cross|evidence|testimony/.test(n))
    return pick('prosecution_evidence', 'plaintiff_evidence', 'petitioner_evidence', 'hearing');
  if (/preliminary investigation|setting/.test(n)) return pick('counter_affidavit');
  if (/hearing|conference/.test(n)) return pick('hearing');
  return null;
}

/**
 * The stage a proceeding has reached: the furthest its hearings point to —
 * the next one included, since that is where it is heading — or its decision
 * once it is resolved, or the first stage when nothing says otherwise.
 */
export function inferStage(track: Track, hearings: { name: string; date: string | null }[], resolved: boolean): string {
  if (resolved) return finalStage(track);
  const keys = STAGES[track].map((s) => s.key);
  let best = 0;
  for (const h of hearings) {
    const k = stageOfHearing(track, h.name);
    if (k) best = Math.max(best, keys.indexOf(k));
  }
  return keys[best];
}

export interface StageStep {
  key: string;
  label: string;
  state: 'done' | 'current' | 'upcoming' | 'skipped';
}

/** A proceeding's stages as steps; optional ones passed over read as skipped. */
export function stageSteps(track: Track, stage: string | null, resolved: boolean): StageStep[] {
  const stages = STAGES[track];
  const at = resolved ? stages.findIndex((s) => s.key === finalStage(track)) : Math.max(0, stages.findIndex((s) => s.key === stage));
  // Every proceeding has an MR period after its decision, so it always shows;
  // execution only once a case gets there.
  const mr = stages.findIndex((s) => s.key === 'reconsideration');
  const lastRequired = stages.length - 1 - [...stages].reverse().findIndex((s) => !s.optional);
  const shown = stages.filter((s, i) => i <= Math.max(at, lastRequired, mr));
  return shown.map((s, i) => ({
    key: s.key,
    label: s.label,
    state: i < at ? (s.optional ? 'skipped' : 'done') : i === at ? (resolved ? 'done' : 'current') : 'upcoming',
  }));
}

export function stageLabel(track: Track | null, stage: string | null): string | null {
  if (!track || !stage) return null;
  return STAGES[track].find((s) => s.key === stage)?.label ?? null;
}
