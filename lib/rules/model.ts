import { SOURCE_META, type RuleSource } from '@/lib/rules/parse-rules-of-court';

export const RULES_OF_COURT_KIND = 'rules_of_court';

export const RULE_SOURCES: RuleSource[] = ['civil', 'criminal', 'evidence'];

/** Which publication a Rule number belongs to. Rules 72–143 (special proceedings) are not imported. */
export function sourceOfRule(rule: number): RuleSource | null {
  if (rule >= 1 && rule <= 71) return 'civil';
  if (rule >= 110 && rule <= 127) return 'criminal';
  if (rule >= 128 && rule <= 134) return 'evidence';
  return null;
}

export function sourceLabel(source: RuleSource): string {
  return SOURCE_META[source].short;
}

export function ruleSlug(source: RuleSource, rule: number): string {
  return `rules-of-court-${source}-rule-${rule}`;
}

export function rulePageTitle(rule: number, ruleTitle: string): string {
  return `Rule ${rule} — ${titleCase(ruleTitle)}`;
}

export function citationOf(rule: number, section: number): string {
  return `Rule ${rule}, Section ${section}`;
}

/** Heading id the Library article assigns: the same slug rule as its table of contents. */
export function headingSlug(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 60);
}

export function sectionHeading(section: number, title: string): string {
  return `Section ${section}. ${title}`;
}

export function sectionAnchor(section: number, title: string): string {
  return headingSlug(sectionHeading(section, title));
}

/** Where a section lives in the app, resolvable without a lookup. */
export function sectionHref(source: RuleSource, rule: number, section?: number | null): string {
  return `/dashboard/library/rules/${source}/${rule}${section ? `?section=${section}` : ''}`;
}

const SMALL = new Set(['of', 'the', 'and', 'or', 'in', 'to', 'for', 'on', 'by', 'a', 'an', 'at', 'from', 'with', 'as']);

/** "MOTION FOR RECONSIDERATION" → "Motion for Reconsideration". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((w, i) => (SMALL.has(w) && i > 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

export interface RuleCitation {
  source: RuleSource;
  rule: number;
  section: number | null;
}

// "Rule 41, Sec. 3", "Rule 65, Section 4", "Rule 37, Sec. 1; Rule 52, Sec. 1", "Sec. 34, Rule 132"
const RULE_THEN_SECTION_RE = /\bRule\s+(\d{1,3})\s*(?:,|of)?\s*(?:Sec(?:tion|s?\.)|§)\s*(\d{1,3})/gi;
const SECTION_THEN_RULE_RE = /\b(?:Sec(?:tion|s?\.)|§)\s*(\d{1,3})\s*(?:,|of)?\s*Rule\s+(\d{1,3})/gi;
const RULE_ONLY_RE = /\bRule\s+(\d{1,3})\b/gi;

/**
 * The Rules of Court provisions a free-text legal basis names. Rules the
 * Library does not carry (NLRC, CTA, summary procedure) are left out, so a
 * basis like "NLRC Rules, Rule VI, Sec. 1" yields nothing rather than a wrong link.
 */
export function parseRuleCitations(text: string | null | undefined): RuleCitation[] {
  const out: RuleCitation[] = [];
  const seen = new Set<string>();
  const push = (rule: number, section: number | null) => {
    const source = sourceOfRule(rule);
    if (!source) return;
    const key = `${rule}:${section ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ source, rule, section });
  };
  const t = text ?? '';
  // Skip bases that plainly belong to another rule book.
  if (/\b(NLRC|CTA|Summary Procedure|Labor Code|NIRC|Tax Appeals)\b/i.test(t) && !/2019 Amended Rules|Rules of Court/i.test(t)) {
    // "Rule 65, Sec. 4; St. Martin Funeral Homes doctrine" is still the Rules of Court.
    if (!/\bRule\s+\d{1,3}\s*,?\s*Sec/i.test(t) || /\b(NLRC|CTA)\s+Rules?,?\s+Rule\b/i.test(t)) return out;
  }
  for (const m of t.matchAll(RULE_THEN_SECTION_RE)) push(Number(m[1]), Number(m[2]));
  for (const m of t.matchAll(SECTION_THEN_RULE_RE)) push(Number(m[2]), Number(m[1]));
  if (out.length === 0) for (const m of t.matchAll(RULE_ONLY_RE)) push(Number(m[1]), null);
  return out;
}

/** Day counts a provision states: "fifteen (15) calendar days", "within thirty (30) days". */
export function dayCountsIn(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\((\d{1,3})\)\s*(?:calendar\s+|working\s+)?days?\b/gi)) out.add(Number(m[1]));
  return [...out];
}
