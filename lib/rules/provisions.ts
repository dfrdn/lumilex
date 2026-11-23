import type { SupabaseClient } from '@supabase/supabase-js';
import { dayCountsIn, parseRuleCitations, sectionHref } from '@/lib/rules/model';
import { sourceLabel } from '@/lib/rules/model';
import type { RuleSource } from '@/lib/rules/parse-rules-of-court';

/** A Rules of Court section a deadline's legal basis points at. */
export interface Provision {
  citation: string;
  title: string;
  sourceLabel: string;
  /** Opening of the section text, enough to read the period it sets. */
  excerpt: string;
  href: string;
  /** Day counts the section states, e.g. [15, 30]. Empty when it sets none. */
  days: number[];
}

const EXCERPT_CHARS = 420;

/**
 * Resolve the provisions each deadline's free-text legal basis names, so the
 * rule text can sit next to the number of days the deadline uses. Bases that
 * cite another rule book (NLRC, CTA) resolve to nothing.
 */
export async function resolveProvisions(
  supabase: SupabaseClient,
  legalBases: string[],
): Promise<Map<string, Provision[]>> {
  const wanted = new Map<string, { source: RuleSource; rule: number; section: number | null }[]>();
  for (const basis of legalBases) {
    if (!wanted.has(basis)) wanted.set(basis, parseRuleCitations(basis));
  }
  const keys = [...new Set([...wanted.values()].flat().filter((c) => c.section != null).map((c) => `${c.source}:${c.rule}:${c.section}`))];
  const out = new Map<string, Provision[]>();
  if (keys.length === 0) return out;

  const orFilter = keys
    .map((k) => {
      const [source, rule, section] = k.split(':');
      return `and(source.eq.${source},rule.eq.${rule},section.eq.${section})`;
    })
    .join(',');
  const { data } = await supabase
    .from('court_rule_sections')
    .select('source, rule, section, citation, title, text')
    .or(orFilter);
  const byKey = new Map<string, Provision>();
  for (const r of data ?? []) {
    byKey.set(`${r.source}:${r.rule}:${r.section}`, {
      citation: r.citation,
      title: r.title,
      sourceLabel: sourceLabel(r.source as RuleSource),
      excerpt: r.text.length > EXCERPT_CHARS ? `${r.text.slice(0, EXCERPT_CHARS).replace(/\s+\S*$/, '')}…` : r.text,
      href: sectionHref(r.source as RuleSource, r.rule, r.section),
      days: dayCountsIn(r.text),
    });
  }
  for (const [basis, cites] of wanted) {
    const provisions = cites
      .map((c) => (c.section != null ? byKey.get(`${c.source}:${c.rule}:${c.section}`) : undefined))
      .filter((p): p is Provision => !!p);
    if (provisions.length > 0) out.set(basis, provisions);
  }
  return out;
}

/** Whether a deadline's day count disagrees with every count its provisions state. */
export function daysDisagree(days: number, provisions: Provision[]): boolean {
  const stated = provisions.flatMap((p) => p.days);
  return stated.length > 0 && !stated.includes(days);
}
