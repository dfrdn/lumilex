/**
 * Assembles section 1 of an engagement proposal.
 *
 * The scope section is built here rather than written by the model. Catalogue
 * lines from lib/scope-library come through verbatim, the model's matter-
 * specific lines sit between them and the carve-outs, and the exclusions clause
 * is always last under one heading. That ordering is the whole point: the same
 * clause used to land under three different subheadings, and once inside
 * another paragraph entirely.
 *
 * Figures come from the checked quote, never from prose. A draft once offered
 * "up to 12.5 hours per month" against a schedule whose tiers are 3, 6, and 10.
 */

import type { LoadedScopeTemplate } from '@/lib/scope-library/types';
import type { ProposalBlock, ProposalQuote, ProposalSection } from './types';

export const SCOPE_HEADING = 'Scope of Services';

/** Stands in for a token the quote can't resolve — visible to the drafter, never silent. */
export const UNRESOLVED = '[to be confirmed]';

/**
 * House style: below 10 the numeral is spelled out with the figure in
 * parentheses; 10 and above stands alone. Non-integers take the numeral —
 * "two and a half (2.5)" is not how the firm writes.
 */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function spellCount(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n);
  return n < 10 ? `${WORDS[n]} (${n})` : String(n);
}

function money(n: number, peso: string): string {
  return `${peso}${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Tokens a scope template may carry. Everything resolvable comes off the quote,
 * which lib/engagement-proposal/quote.ts has already reconciled against the
 * live fee schedule.
 *
 * `peso` is the prefix the firm's own typeface set can print — `pesoSymbol()`
 * in lib/pdf/fonts.ts, the same decision `peso()` makes for the fee schedules
 * bound behind the letter. It is required rather than defaulted: a scope line
 * filled with a prefix the firm's faces cannot set prints a notdef box, and a
 * default would pick that for whichever tenant happens not to match it.
 */
export function scopeTokens(
  quote: ProposalQuote | null | undefined,
  peso: string,
): Record<string, string> {
  return {
    retainerHours: quote?.retainerHours == null ? UNRESOLVED : spellCount(quote.retainerHours),
    monthlyFee: quote?.monthlyFee == null ? UNRESOLVED : money(quote.monthlyFee, peso),
    initialFee: quote?.initialFee == null ? UNRESOLVED : money(quote.initialFee, peso),
    initialFeeMonths: quote?.initialFeeMonths == null ? UNRESOLVED : spellCount(quote.initialFeeMonths),
    tierLabel: quote?.tierLabel ?? UNRESOLVED,
  };
}

const TOKEN_SOURCE = '\\{\\{\\s*(\\w+)\\s*\\}\\}';

/** A `{{token}}` that survived substitution, i.e. one nothing answers to. */
const HAS_TOKEN = new RegExp(TOKEN_SOURCE);

/** Replace `{{token}}` throughout a string. Unknown tokens are left visible. */
export function fillTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(new RegExp(TOKEN_SOURCE, 'g'), (whole, key: string) => tokens[key] ?? whole);
}

function fillBlock(block: ProposalBlock, tokens: Record<string, string>): ProposalBlock {
  switch (block.kind) {
    case 'para':
    case 'subheading':
      return { ...block, text: fillTokens(block.text, tokens) };
    case 'labelled':
      return { ...block, label: fillTokens(block.label, tokens), text: fillTokens(block.text, tokens) };
    case 'list':
      return { ...block, items: block.items.map((i) => fillTokens(i, tokens)) };
    case 'feeTable':
      return {
        ...block,
        rows: block.rows.map((r) => ({
          fee: fillTokens(r.fee, tokens),
          amount: fillTokens(r.amount, tokens),
          when: fillTokens(r.when, tokens),
        })),
      };
  }
}

/** A scope line the model wrote for this matter specifically. */
export interface BespokeScopeLine {
  subheading: string;
  blocks: ProposalBlock[];
}

export interface BuildScopeInput {
  /** The whole library, in catalogue order. */
  templates: LoadedScopeTemplate[];
  /** Slugs the drafter selected. Order is ignored — the catalogue's order wins. */
  selectedSlugs: string[];
  /** Matter-specific lines from the model, placed after the catalogue lines. */
  bespokeLines?: BespokeScopeLine[];
  /** Optional opening paragraph setting out the matter's facts. */
  intro?: string;
  quote?: ProposalQuote | null;
  /** The currency prefix this firm's typeface set can print. */
  pesoSymbol: string;
}

/**
 * Section 1, in a fixed order: an optional factual opening, the selected
 * catalogue lines in catalogue order, the model's matter-specific lines, and
 * the exclusions clause last.
 */
export function buildScopeSection(input: BuildScopeInput): ProposalSection {
  const tokens = scopeTokens(input.quote, input.pesoSymbol);
  const selected = new Set(input.selectedSlugs);
  const chosen = input.templates.filter((t) => selected.has(t.slug) && t.isActive);

  const blocks: ProposalBlock[] = [];

  const intro = input.intro?.trim();
  if (intro) blocks.push({ kind: 'para', text: intro });

  for (const t of chosen.filter((t) => t.content.role === 'service')) {
    blocks.push({ kind: 'subheading', text: t.content.subheading });
    for (const b of t.content.blocks) blocks.push(fillBlock(b, tokens));
  }

  // The model is told not to state figures, but a line it wrote is filled the
  // same way a catalogue line is: an emitted token must not print as braces in
  // a letter that goes to a client.
  for (const line of input.bespokeLines ?? []) {
    const heading = line.subheading?.trim();
    if (heading) blocks.push({ kind: 'subheading', text: fillTokens(heading, tokens) });
    for (const b of line.blocks) blocks.push(fillBlock(b, tokens));
  }

  // One exclusions clause, always last. Selecting two is a CMS mistake, not a
  // reason to print both — the first in catalogue order wins.
  const exclusions = chosen.find((t) => t.content.role === 'exclusions');
  if (exclusions) {
    blocks.push({ kind: 'subheading', text: exclusions.content.subheading });
    for (const b of exclusions.content.blocks) blocks.push(fillBlock(b, tokens));
  }

  return { heading: SCOPE_HEADING, blocks };
}

/** The blocks a catalogue line contributes: its subheading, then its body. */
function lineBlocks(t: LoadedScopeTemplate, tokens: Record<string, string>): ProposalBlock[] {
  return [
    { kind: 'subheading', text: t.content.subheading },
    ...t.content.blocks.map((b) => fillBlock(b, tokens)),
  ];
}

/**
 * Where a new service line belongs in a scope section that already exists:
 * above the carve-outs, which always read last.
 *
 * A stored proposal doesn't record which blocks came from the library, so the
 * carve-outs are found by their subheading. A partner who renamed that heading
 * gets an append instead — visible, and one drag from right.
 */
export function scopeInsertIndex(section: ProposalSection, templates: LoadedScopeTemplate[]): number {
  const exclusionHeadings = new Set(
    templates
      .filter((t) => t.content.role === 'exclusions')
      .map((t) => t.content.subheading.trim().toLowerCase()),
  );
  if (!exclusionHeadings.size) return section.blocks.length;

  const at = section.blocks.findIndex(
    (b) => b.kind === 'subheading' && exclusionHeadings.has(b.text.trim().toLowerCase()),
  );
  return at === -1 ? section.blocks.length : at;
}

/** Subheadings already present, so the picker can say what would duplicate. */
export function presentSubheadings(section: ProposalSection): Set<string> {
  return new Set(
    section.blocks
      .filter((b): b is Extract<ProposalBlock, { kind: 'subheading' }> => b.kind === 'subheading')
      .map((b) => b.text.trim().toLowerCase()),
  );
}

/**
 * Insert catalogue lines into a scope section that already exists — the
 * revision path, where the letter was drafted before the line was wanted.
 *
 * Figures come from the proposal's own quote, so an inserted line states the
 * cap that letter actually agreed rather than the current schedule's.
 */
export function insertScopeLines(
  section: ProposalSection,
  templates: LoadedScopeTemplate[],
  slugs: string[],
  quote: ProposalQuote | null | undefined,
  pesoSymbol: string,
): ProposalSection {
  const selected = new Set(slugs);
  const chosen = templates.filter((t) => selected.has(t.slug) && t.isActive);
  if (!chosen.length) return section;

  const tokens = scopeTokens(quote, pesoSymbol);

  // A line already in the section is not inserted again — the picker marks it
  // "already in this section", and printing the firm's wording twice is the
  // drift this library exists to stop.
  const present = presentSubheadings(section);
  const fresh = chosen.filter((t) => !present.has(t.content.subheading.trim().toLowerCase()));
  if (!fresh.length) return section;

  const services = fresh.filter((t) => t.content.role === 'service');
  const exclusions = fresh.filter((t) => t.content.role === 'exclusions');

  const blocks = [...section.blocks];

  // Service lines go above the carve-outs; a carve-out line appends, since it
  // is what "last" means.
  const at = scopeInsertIndex(section, templates);
  blocks.splice(at, 0, ...services.flatMap((t) => lineBlocks(t, tokens)));

  for (const t of exclusions) blocks.push(...lineBlocks(t, tokens));

  return { ...section, blocks };
}

/**
 * Fee schedules the selected lines cross-refer, so an offer can't reach the
 * client without the annex that prices it.
 */
export function scheduleSlugsFor(templates: LoadedScopeTemplate[], selectedSlugs: string[]): string[] {
  const selected = new Set(selectedSlugs);
  const out = new Set<string>();
  for (const t of templates) {
    if (!selected.has(t.slug)) continue;
    for (const slug of t.content.feeScheduleSlugs) out.add(slug);
  }
  return [...out];
}

/**
 * A rendered scope line still carrying an unresolved figure — either the
 * stand-in the quote could not fill, or a `{{token}}` that survived
 * substitution because nothing on the quote answers to that name.
 */
export function unresolvedTokens(section: ProposalSection): boolean {
  const texts = section.blocks.flatMap((b) => {
    switch (b.kind) {
      case 'para':
      case 'subheading':
        return [b.text];
      case 'labelled':
        return [b.label, b.text];
      case 'list':
        return b.items;
      case 'feeTable':
        return b.rows.flatMap((r) => [r.fee, r.amount, r.when]);
    }
  });
  return texts.some((t) => t.includes(UNRESOLVED) || HAS_TOKEN.test(t));
}
