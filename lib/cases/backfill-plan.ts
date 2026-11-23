/**
 * Turns the case fields matters carry today (case_number, court, case_title)
 * into cases and proceedings, without touching the database: a case is the
 * dispute, a proceeding is one forum's handling of it, and matters sharing a
 * docket are one case. Pure, so the plan can be reviewed before anything is
 * written.
 */

import { detectTrack, finalStage, inferStage, type Track } from './stages';

export type ForumType = 'court' | 'prosecutor' | 'doj' | 'ombudsman' | 'labor' | 'law_enforcement' | 'agency' | 'unknown';
export type CourtLevel = 'sc' | 'ca' | 'sandiganbayan' | 'cta' | 'rtc' | 'mtc';
export type Relation = 'original' | 'referral' | 'review' | 'information' | 'appeal' | 'rule_45' | 'rule_65' | 'other';

export interface Forum {
  type: ForumType;
  level: CourtLevel | null;
}

export interface SourceMatter {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  clientId: string | null;
  clientName: string;
  caseNumber: string;
  court: string;
  caseTitle: string;
  relatedMatterIds: string[];
}

export interface PlannedProceeding {
  key: string;
  track: Track;
  /** The stage its hearings say it has reached (lib/cases/stages.ts). */
  stage: string;
  forum: Forum;
  office: string;
  docket: string | null;
  /** The caption in this forum: "Northwind Power v. Valdez" at the OCP, "People v. Valdez" in court. */
  caption: string;
  relation: Relation;
  /** Key of the proceeding this one came from; null for the original. */
  parentKey: string | null;
  resolved: boolean;
  matterIds: string[];
  hearingCount: number;
}

export interface PlannedCase {
  key: string;
  title: string;
  /** What the case is about — "Estafa", "Unlawful Detainer". */
  nature: string | null;
  status: 'evaluation' | 'active' | 'closed';
  clientIds: string[];
  proceedings: PlannedProceeding[];
  /** Matters covering the case before any proceeding (study, demand). */
  evaluationMatterIds: string[];
  matterIds: string[];
  flags: string[];
}

export interface CasePlan {
  cases: PlannedCase[];
  excluded: { matter: SourceMatter; reason: string }[];
  /** Pairs of case keys linked through related_matter_ids. */
  related: [string, string][];
  /**
   * Related pairs that look like one dispute under a new docket — a complaint
   * at the prosecutor's and the case filed in court on it. Listed for a
   * person to merge; never merged automatically.
   */
  likelySameDispute: [string, string][];
  /** Litigation and labor matters with no case data at all. */
  withoutCase: SourceMatter[];
}

export interface PlanOptions {
  /** Each matter's hearings, for reading the stage a proceeding has reached. */
  hearingNames?: Map<string, { name: string; date: string | null }[]>;
  /** Matters with a hearing still to come: their case and proceeding are open whatever the matter's status. */
  upcomingHearings?: Set<string>;
  /** Matter codes that aren't cases (a permit, a trademark filing). */
  exclude?: Record<string, string>;
  /** Matter codes that cover a case's evaluation phase rather than a proceeding. */
  evaluation?: string[];
  /** Matter codes, a group per dispute, to make one case though their dockets differ. */
  merge?: string[][];
}

const CASE_PREFIX =
  /^\s*(NPS\s+)?(DOCKET|CRIM(INAL)?\.?\s*CASES?|CIVIL\s*CASES?|ADMINISTRATIVE\s*CASES?|ADMIN\.?\s*CASES?|CASES?|G\.?\s*R\.?|CA-G\.?R\.?\s*(SP|CV|CR)?)\s*(NOS?\.?)?\s*/i;

/** A docket number reduced to what identifies it: no "NPS Docket No.", no punctuation, one case. */
export function docketKey(docket: string): string {
  return docket.replace(CASE_PREFIX, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** A docket field that seems to hold more than one number. */
export function looksMultiDocket(docket: string): boolean {
  return /[,;&]|\sand\s/i.test(docket);
}

/** Which kind of forum a court or office name is, from the way the firm writes them. */
export function classifyForum(office: string): Forum {
  const o = office.trim();
  const court = (level: CourtLevel): Forum => ({ type: 'court', level });
  if (!o) return { type: 'unknown', level: null };
  if (/\bS\.?C\.?\b|supreme court/i.test(o)) return court('sc');
  if (/sandiganbayan/i.test(o)) return court('sandiganbayan');
  if (/\bCTA\b|court of tax appeals/i.test(o)) return court('cta');
  if (/\bCA\b|court of appeals/i.test(o)) return court('ca');
  if (/\b(RTC|FC)\b|regional trial court|family court/i.test(o)) return court('rtc');
  if (/\b(MeTC|MTCC|MTC|MCTC)\b|municipal trial|metropolitan trial/i.test(o)) return court('mtc');
  if (/\b(OCP|OPP|NPS)\b|prosecutor/i.test(o)) return { type: 'prosecutor', level: null };
  if (/\bDOJ\b|department of justice/i.test(o)) return { type: 'doj', level: null };
  if (/ombu?d?s?man|ombusdman/i.test(o)) return { type: 'ombudsman', level: null };
  if (/\b(NLRC|DOLE|NCMB|RCMB)\b/i.test(o)) return { type: 'labor', level: null };
  if (/\bNBI\b|national bureau of investigation|\bPNP\b|\bCIDG\b/i.test(o)) return { type: 'law_enforcement', level: null };
  return { type: 'agency', level: null };
}

/** Where a forum sits in the usual path of a dispute, earliest first. */
function forumRank(f: Forum): number {
  if (f.type === 'law_enforcement') return 0;
  if (f.type === 'prosecutor') return 1;
  if (f.type === 'doj') return 2;
  if (f.type === 'court') return { mtc: 3, rtc: 4, sandiganbayan: 5, cta: 5, ca: 6, sc: 7 }[f.level!];
  return 1;
}

function forumId(f: Forum): string {
  return f.level ? `${f.type}:${f.level}` : f.type;
}

/**
 * Where each proceeding hangs in the tree, and how it came from its parent.
 * The DOJ's review and the court case on the Information both come from the
 * prosecutor's resolution; a court proceeding comes from the court below it;
 * "Rule 65" or "Rule 45" in what the matter is about says which petition it
 * was. `certain: false` is flagged for a person to check.
 */
function placeIn(
  ordered: { forum: Forum; nature: string }[],
  i: number,
): { parent: number | null; relation: Relation; certain: boolean } {
  if (i === 0) return { parent: null, relation: 'original', certain: true };
  const { forum, nature } = ordered[i];
  const find = (pred: (f: Forum) => boolean) => {
    for (let j = i - 1; j >= 0; j--) if (pred(ordered[j].forum)) return j;
    return null;
  };
  const prosecutor = find((f) => f.type === 'prosecutor');
  if (forum.type === 'doj' && prosecutor != null) return { parent: prosecutor, relation: 'review', certain: true };
  if (forum.type === 'prosecutor') {
    const nbi = find((f) => f.type === 'law_enforcement');
    if (nbi != null) return { parent: nbi, relation: 'referral', certain: true };
  }
  if (forum.type === 'court') {
    const below = find((f) => f.type === 'court');
    if (below == null && prosecutor != null) return { parent: prosecutor, relation: 'information', certain: true };
    if (below != null) {
      if (/rule\s*65/i.test(nature)) return { parent: below, relation: 'rule_65', certain: true };
      if (/rule\s*45/i.test(nature)) return { parent: below, relation: 'rule_45', certain: true };
      if (forum.level === 'sc') return { parent: below, relation: 'rule_45', certain: false };
      return { parent: below, relation: 'appeal', certain: forum.level !== 'ca' };
    }
  }
  return { parent: i - 1, relation: 'other', certain: false };
}

const SUFFIX = /\s*\((OCP|OPP|DOJ|NBI|CA|SC|RTC|MTC|[A-Z]{2,4})\)\s*$/;
const CAPTION = /\bvs?\.?\s|\bversus\b|^people of|^in re\b|^in the matter/i;

/** A matter's name as a case caption: "[21] Castillo v. Rivera (OCP)" → "Castillo v. Rivera". */
function captionOf(name: string): string {
  return name.replace(/^\[[^\]]*\]\s*/, '').replace(SUFFIX, '').trim();
}

/**
 * What the case is about. The firm's case_title field mostly holds the nature
 * ("Estafa", "Unlawful Detainer"); the caption, where it holds one instead,
 * goes to the proceeding. Pass the matters first-filed first: a later
 * petition's own subject ("Certiorari under Rule 65") isn't the case's.
 */
function natureOf(matters: SourceMatter[]): string | null {
  return matters.map((m) => m.caseTitle.trim()).find((t) => t && !CAPTION.test(t)) ?? null;
}

/** A proceeding's caption: a caption-like case_title, else its matters' names, "People v. …" first. */
function captionFor(matters: SourceMatter[]): string {
  const field = matters.map((m) => m.caseTitle.trim()).find((t) => CAPTION.test(t));
  if (field) return field;
  const names = matters.map((m) => captionOf(m.name)).filter(Boolean);
  const captions = names.filter((n) => CAPTION.test(n));
  return captions.find((n) => /^people\b/i.test(n)) ?? captions[0] ?? names[0] ?? '';
}

/** The proceeding that titles the case, by the rule case_title_source() applies in the database. */
function titleProceeding(procs: PlannedProceeding[]): PlannedProceeding | null {
  const byKey = new Map(procs.map((p) => [p.key, p]));
  const underRule65 = (p: PlannedProceeding): boolean => {
    for (let q: PlannedProceeding | undefined = p; q; q = q.parentKey ? byKey.get(q.parentKey) : undefined) {
      if (q.relation === 'rule_65') return true;
    }
    return false;
  };
  const depth = (p: PlannedProceeding): number => (p.parentKey ? 1 + depth(byKey.get(p.parentKey)!) : 0);
  const main = procs.filter((p) => !underRule65(p));
  main.sort((a, b) => forumRank(b.forum) - forumRank(a.forum) || depth(b) - depth(a));
  return main[0] ?? null;
}

const ongoing = (m: SourceMatter) => m.status === 'Ongoing';

const NOISE = new Set(['et', 'al', 'and', 'the', 'inc', 'corp', 'corporation', 'co', 'spouses', 'sps', 'of', 'people', 'philippines']);

/** The respondents' distinctive words: "People v. Valdez, et al." → {"valdez"}. */
export function respondentWords(title: string): Set<string> {
  const parts = title.split(/\bvs?\.?\s|\bversus\b/i);
  if (parts.length < 2) return new Set();
  return new Set(
    parts[1]
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .split(/[^a-zñ]+/)
      .filter((w) => w.length > 2 && !NOISE.has(w)),
  );
}

/**
 * Two cases that are probably one dispute at two stages: the same respondents,
 * and one sits earlier on the usual path (NBI or prosecutor before a court,
 * a lower court before a higher one).
 */
export function looksLikeSameDispute(a: PlannedCase, b: PlannedCase): boolean {
  const ra = respondentWords(a.title);
  const rb = respondentWords(b.title);
  if (!ra.size || ![...ra].some((w) => rb.has(w))) return false;
  const first = (c: PlannedCase) => c.proceedings[0]?.forum;
  const last = (c: PlannedCase) => c.proceedings[c.proceedings.length - 1]?.forum;
  const fa = last(a), fb = first(b), ga = last(b), gb = first(a);
  return (!!fa && !!fb && forumRank(fa) < forumRank(fb)) || (!!ga && !!gb && forumRank(ga) < forumRank(gb));
}

export function buildCasePlan(
  matters: SourceMatter[],
  hearingsByMatter: Map<string, number>,
  opts: PlanOptions = {},
): CasePlan {
  const exclude = opts.exclude ?? {};
  const upcoming = opts.upcomingHearings ?? new Set<string>();
  const isOpen = (m: SourceMatter) => ongoing(m) || upcoming.has(m.id);
  const evaluation = new Set(opts.evaluation ?? []);
  const excluded: CasePlan['excluded'] = [];
  const withoutCase: SourceMatter[] = [];

  // Group by docket; a matter with no docket is a case of its own.
  const groups = new Map<string, SourceMatter[]>();
  for (const m of matters) {
    const hasCase = !!(m.caseNumber.trim() || m.court.trim() || m.caseTitle.trim());
    if (exclude[m.code]) {
      if (hasCase) excluded.push({ matter: m, reason: exclude[m.code] });
      continue;
    }
    if (!hasCase) {
      if (m.type === 'Litigation' || m.type === 'Labor') withoutCase.push(m);
      continue;
    }
    const key = m.caseNumber.trim() ? `docket:${docketKey(m.caseNumber)}` : `matter:${m.id}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  // A dispute that changed docket when it moved forum: the merge groups say so.
  for (const codes of opts.merge ?? []) {
    const keys = [...groups].filter(([, ms]) => ms.some((m) => codes.includes(m.code))).map(([k]) => k);
    if (keys.length < 2) continue;
    const [into, ...rest] = keys;
    for (const k of rest) {
      groups.get(into)!.push(...groups.get(k)!);
      groups.delete(k);
    }
  }

  const cases: PlannedCase[] = [];
  const caseOfMatter = new Map<string, string>();

  for (const [key, group] of groups) {
    group.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const flags: string[] = [];
    const evalMatters = group.filter((m) => evaluation.has(m.code));
    const procMatters = group.filter((m) => !evaluation.has(m.code));

    // One proceeding per forum: matters in the same forum (several clients in one case) share it.
    const byForum = new Map<string, { forum: Forum; matters: SourceMatter[] }>();
    for (const m of procMatters) {
      if (!m.court.trim() && !m.caseNumber.trim()) continue;
      // No court on record: a "(DOJ)" or "(OCP)" on the matter's name still says which forum.
      const forum = classifyForum(m.court.trim() || (m.name.match(SUFFIX)?.[1] ?? ''));
      const id = forumId(forum);
      const entry = byForum.get(id) ?? { forum, matters: [] };
      entry.matters.push(m);
      byForum.set(id, entry);
    }

    const ordered = [...byForum.values()]
      .sort((a, b) => forumRank(a.forum) - forumRank(b.forum))
      .map((p) => ({ ...p, nature: p.matters.map((m) => m.caseTitle).join(' ') }));
    const pkey = (p: (typeof ordered)[number]) => `${key}#${forumId(p.forum)}`;
    const proceedings: PlannedProceeding[] = ordered.map((p, i) => {
      const place = placeIn(ordered, i);
      const parent = place.parent != null ? ordered[place.parent] : null;
      const office = p.matters.find((m) => m.court.trim())?.court.trim() ?? '';
      const docket = p.matters.find((m) => m.caseNumber.trim())?.caseNumber.trim() ?? null;
      if (!place.certain) flags.push(`check how the ${office || p.forum.type} proceeding came from the ${parent?.matters[0].court.trim() || 'earlier'} one`);
      if (p.forum.type === 'unknown') flags.push('no forum recorded');
      if (docket && looksMultiDocket(docket)) flags.push(`docket field may hold several numbers: "${docket}"`);
      const caption = captionFor(p.matters);
      const resolved = !p.matters.some(isOpen);
      const track = detectTrack({
        forumType: p.forum.type,
        courtLevel: p.forum.level,
        relation: place.relation,
        docketNo: docket,
        caption,
        nature: natureOf(p.matters) ?? natureOf(group),
      });
      const heard = p.matters.flatMap((m) => opts.hearingNames?.get(m.id) ?? []);
      return {
        key: pkey(p),
        track,
        stage: inferStage(track, heard, resolved),
        forum: p.forum,
        office,
        docket,
        caption,
        relation: place.relation,
        parentKey: parent ? pkey(parent) : null,
        resolved,
        matterIds: p.matters.map((m) => m.id),
        hearingCount: p.matters.reduce((n, m) => n + (hearingsByMatter.get(m.id) ?? 0), 0),
      };
    });

    // A review, an Information, an appeal or a referral can only follow a
    // resolution: whatever its matter says, the proceeding under it is done.
    // A Rule 65 petition runs beside one still going.
    for (const p of proceedings) {
      const followed = proceedings.some((c) => c.parentKey === p.key && c.relation !== 'rule_65' && c.relation !== 'other');
      if (followed && !p.resolved) {
        p.resolved = true;
        p.stage = finalStage(p.track);
      }
    }

    if (!proceedings.length && !evalMatters.length) flags.push('title only — no court or docket recorded');
    const evalHearings = evalMatters.reduce((n, m) => n + (hearingsByMatter.get(m.id) ?? 0), 0);
    if (evalHearings) flags.push(`${evalHearings} hearing(s) on an evaluation matter — assign them to a proceeding`);
    const clients = [...new Set(group.map((m) => m.clientId).filter((c): c is string => !!c))];
    if (clients.length > 1) flags.push(`${clients.length} clients`);

    const status: PlannedCase['status'] = !proceedings.length
      ? 'evaluation'
      : group.some(isOpen)
        ? 'active'
        : 'closed';

    cases.push({
      key,
      title: titleProceeding(proceedings)?.caption || captionFor(group) || group[0].name,
      nature: natureOf([...ordered.flatMap((p) => p.matters), ...evalMatters, ...group]),
      status,
      clientIds: clients,
      proceedings,
      evaluationMatterIds: evalMatters.map((m) => m.id),
      matterIds: group.map((m) => m.id),
      flags,
    });
    for (const m of group) caseOfMatter.set(m.id, key);
  }

  const seen = new Set<string>();
  const related: [string, string][] = [];
  for (const m of matters) {
    const a = caseOfMatter.get(m.id);
    if (!a) continue;
    for (const r of m.relatedMatterIds) {
      const b = caseOfMatter.get(r);
      if (!b || b === a) continue;
      const pair = [a, b].sort() as [string, string];
      const id = pair.join('|');
      if (!seen.has(id)) {
        seen.add(id);
        related.push(pair);
      }
    }
  }

  const byKey = new Map(cases.map((c) => [c.key, c]));
  const likelySameDispute = related.filter(([a, b]) => looksLikeSameDispute(byKey.get(a)!, byKey.get(b)!));

  // Matters nobody marked related can still be one dispute: the same caption
  // and the same nature in courts or offices at different levels (an RTC
  // special proceeding and its CA appeal).
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  const listed = new Set(likelySameDispute.map(([a, b]) => pairKey(a, b)));
  const norm = (t: string | null) => (t ?? '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
  const bySignature = new Map<string, PlannedCase[]>();
  for (const c of cases) {
    if (!c.nature || !c.proceedings.length) continue;
    const sig = `${norm(c.title)}|${norm(c.nature)}`;
    bySignature.set(sig, [...(bySignature.get(sig) ?? []), c]);
  }
  for (const group of bySignature.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        const ra = forumRank(a.proceedings[0].forum);
        const rb = forumRank(b.proceedings[0].forum);
        if (ra === rb || listed.has(pairKey(a.key, b.key))) continue;
        listed.add(pairKey(a.key, b.key));
        likelySameDispute.push([a.key, b.key].sort() as [string, string]);
      }
    }
  }

  cases.sort((a, b) => a.title.localeCompare(b.title));
  return { cases, excluded, related, likelySameDispute, withoutCase };
}
