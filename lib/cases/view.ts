import type { Track } from './stages';

/**
 * How a case reads: its proceedings as a main line with branches, where it
 * stands, which hearing is next and which need an outcome recorded. Pure, so
 * the list, the page and their tests agree.
 */

export type CaseStatus = 'evaluation' | 'active' | 'closed';
export type ForumType = 'court' | 'prosecutor' | 'doj' | 'ombudsman' | 'labor' | 'law_enforcement' | 'agency' | 'unknown';
export type CourtLevel = 'sc' | 'ca' | 'sandiganbayan' | 'cta' | 'rtc' | 'mtc';
export type Relation = 'original' | 'referral' | 'review' | 'information' | 'appeal' | 'rule_45' | 'rule_65' | 'other';

export interface Proceeding {
  id: string;
  /** Which stages it goes through (lib/cases/stages.ts); null until set. */
  track: Track | null;
  parentId: string | null;
  relation: Relation;
  forumType: ForumType;
  courtLevel: CourtLevel | null;
  office: string;
  docketNo: string | null;
  caption: string;
  status: 'active' | 'resolved';
  stage: string | null;
  resolution: string | null;
  mrDueOn: string | null;
  filedOn: string | null;
  resolvedOn: string | null;
  createdAt: string;
}

export interface Hearing {
  id: string;
  name: string;
  type: string;
  attendeeIds: string[];
  matterId: string | null;
  matterName: string;
  /** ISO timestamp. */
  date: string | null;
  proceedingId: string | null;
  status: string;
  isAttended: boolean;
}

export const RELATION_LABEL: Record<Relation, string> = {
  original: 'Filed',
  referral: 'Referred',
  review: 'Petition for review',
  information: 'Information filed',
  appeal: 'Appeal',
  rule_45: 'Rule 45 petition',
  rule_65: 'Rule 65 petition',
  other: 'Then',
};

const LEVEL_SHORT: Record<CourtLevel, string> = { sc: 'SC', ca: 'CA', sandiganbayan: 'Sandiganbayan', cta: 'CTA', rtc: 'RTC', mtc: 'MTC' };
const FORUM_SHORT: Record<Exclude<ForumType, 'court'>, string> = {
  prosecutor: 'Prosecutor',
  doj: 'DOJ',
  ombudsman: 'Ombudsman',
  labor: 'Labor',
  law_enforcement: 'NBI / police',
  agency: 'Agency',
  unknown: 'Forum not recorded',
};

/** A proceeding's forum in a word or two: "RTC", "DOJ", "Prosecutor". */
export function forumShort(p: Pick<Proceeding, 'forumType' | 'courtLevel'>): string {
  return p.forumType === 'court' && p.courtLevel ? LEVEL_SHORT[p.courtLevel] : FORUM_SHORT[p.forumType as Exclude<ForumType, 'court'>];
}

/** Where a forum sits on the path, as case_title_source() ranks it. */
export function forumRank(p: Pick<Proceeding, 'forumType' | 'courtLevel'>): number {
  if (p.forumType === 'court') return { sc: 7, ca: 6, sandiganbayan: 5, cta: 5, rtc: 4, mtc: 3 }[p.courtLevel ?? 'mtc'];
  if (p.forumType === 'doj') return 2;
  if (p.forumType === 'law_enforcement') return 0;
  return 1;
}

/** A Rule 65 petition, or anything under one: it runs beside the case, never along it. */
export function isBranch(p: Proceeding, byId: Map<string, Proceeding>): boolean {
  for (let q: Proceeding | undefined = p; q; q = q.parentId ? byId.get(q.parentId) : undefined) {
    if (q.relation === 'rule_65') return true;
  }
  return false;
}

/**
 * The proceedings in the order a reader follows them: parents before
 * children, each parent's children by when they were filed — so OCP, then
 * the DOJ review and the court case on the Information.
 */
export function inTreeOrder(proceedings: Proceeding[]): { proceeding: Proceeding; depth: number }[] {
  const children = new Map<string | null, Proceeding[]>();
  for (const p of proceedings) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p]);
  const byTime = (a: Proceeding, b: Proceeding) =>
    forumRank(a) - forumRank(b) || (a.filedOn ?? a.createdAt).localeCompare(b.filedOn ?? b.createdAt);
  const out: { proceeding: Proceeding; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const p of [...(children.get(parent) ?? [])].sort(byTime)) {
      out.push({ proceeding: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The proceeding the case is titled after, by the rule the database applies. */
export function titleProceeding(proceedings: Proceeding[]): Proceeding | null {
  const byId = new Map(proceedings.map((p) => [p.id, p]));
  const depth = (p: Proceeding): number => (p.parentId && byId.get(p.parentId) ? 1 + depth(byId.get(p.parentId)!) : 0);
  const main = proceedings.filter((p) => !isBranch(p, byId));
  main.sort(
    (a, b) =>
      forumRank(b) - forumRank(a) ||
      depth(b) - depth(a) ||
      (b.filedOn ?? '').localeCompare(a.filedOn ?? '') ||
      b.createdAt.localeCompare(a.createdAt),
  );
  return main[0] ?? null;
}

/** Captions the case went by earlier, with where: "At the Prosecutor: Northwind Power v. Valdez". */
export function earlierCaptions(title: string, proceedings: Proceeding[]): { forum: string; caption: string }[] {
  const seen = new Set([title.trim().toLowerCase()]);
  const out: { forum: string; caption: string }[] = [];
  for (const { proceeding: p } of inTreeOrder(proceedings)) {
    const c = p.caption.trim();
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    out.push({ forum: forumShort(p), caption: c });
  }
  return out;
}

export type HearingOutcome = 'upcoming' | 'attended' | 'cancelled' | 'unrecorded';

/** What became of a hearing. Status is often blank in the record; attended is also a flag. */
export function hearingOutcome(h: Hearing, now = new Date()): HearingOutcome {
  const s = h.status.toLowerCase();
  if (s === 'cancelled') return 'cancelled';
  if (h.isAttended || s === 'attended' || s === 'filed') return 'attended';
  if (h.date && new Date(h.date) >= now) return 'upcoming';
  return 'unrecorded';
}

/** The next hearing that is still to come, if any. */
export function nextHearing(hearings: Hearing[], now = new Date()): Hearing | null {
  return (
    hearings
      .filter((h) => h.date && hearingOutcome(h, now) === 'upcoming')
      .sort((a, b) => a.date!.localeCompare(b.date!))[0] ?? null
  );
}

/** Hearings within this many days show in Needs action. */
export const HEARING_HORIZON_DAYS = 14;

/** How far back a hearing with no outcome still asks for one. Older ones are history. */
export const UNRECORDED_DAYS = 30;

export function needsOutcome(hearings: Hearing[], now = new Date()): Hearing[] {
  const since = new Date(now.getTime() - UNRECORDED_DAYS * 86_400_000);
  return hearings
    .filter((h) => h.date && new Date(h.date) >= since && hearingOutcome(h, now) === 'unrecorded')
    .sort((a, b) => b.date!.localeCompare(a.date!));
}
