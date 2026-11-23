/**
 * Choosing which scope lines a proposal starts with.
 *
 * Kept apart from load.ts so the proposal builder can run the same selection
 * in the browser that the drafting route runs on the server — importing the
 * loader would drag the service-role Supabase client into the client bundle.
 */

import type { LoadedScopeTemplate, ProposalArrangement } from './types';

/** Lines offered under this arrangement — an empty `arrangements` means any. */
export function offeredFor(
  templates: LoadedScopeTemplate[],
  arrangement: ProposalArrangement,
): LoadedScopeTemplate[] {
  return templates.filter(
    (t) => t.isActive && (t.content.arrangements.length === 0 || t.content.arrangements.includes(arrangement)),
  );
}

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** `needle`'s words appearing in order, unbroken, inside `hay`. */
function containsPhrase(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  return hay.some((_, i) => needle.every((w, j) => hay[i + j] === w));
}

/**
 * Whether two phrases name the same thing — either contains the other, whole
 * words only. Substrings would match on fragments: the alias "ip" sits inside
 * "equipment", which pre-selected IP Services (and its annex) on an equipment
 * leasing intake.
 */
function phrasesMatch(a: string[], b: string[]): boolean {
  return containsPhrase(a, b) || containsPhrase(b, a);
}

/**
 * The lines to start a drafter off with: whatever auto-selects for this
 * arrangement, plus anything the intake's `proposed_services` names.
 *
 * The intake field is free text a lawyer typed during a consultation, so the
 * match is deliberately loose — it only seeds the picker, and the drafter
 * confirms the selection before anything is drafted.
 */
export function defaultScopeSlugs(
  templates: LoadedScopeTemplate[],
  arrangement: ProposalArrangement,
  proposedServices: string[] = [],
): string[] {
  const offered = offeredFor(templates, arrangement);
  const picked = new Set(offered.filter((t) => t.content.autoSelect).map((t) => t.slug));

  const wanted = proposedServices.map(words).filter((w) => w.length);
  for (const t of offered) {
    if (t.content.role !== 'service') continue;
    const keys = [t.content.name, t.content.subheading, ...t.content.aliases].map(words);
    if (wanted.some((w) => keys.some((k) => phrasesMatch(k, w)))) {
      picked.add(t.slug);
    }
  }

  // Exactly one exclusions clause, and it goes last — see buildScopeSection.
  const exclusions = offered.filter((t) => t.content.role === 'exclusions' && picked.has(t.slug));
  for (const extra of exclusions.slice(1)) picked.delete(extra.slug);

  return offered.filter((t) => picked.has(t.slug)).map((t) => t.slug);
}
