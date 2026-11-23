import { describe, it, expect } from 'vitest';
import {
  SCOPE_HEADING, UNRESOLVED, buildScopeSection, fillTokens, insertScopeLines,
  presentSubheadings, scheduleSlugsFor, scopeTokens, spellCount, unresolvedTokens,
  type BuildScopeInput,
} from './scope';
import { DEFAULT_SCOPE_TEMPLATES } from '@/lib/scope-library/default';
import { defaultScopeSlugs } from '@/lib/scope-library/select';
import type { LoadedScopeTemplate, ScopeTemplateContent } from '@/lib/scope-library/types';
import type { ProposalQuote, ProposalSection } from './types';

function loaded(content: ScopeTemplateContent, i: number): LoadedScopeTemplate {
  return { id: null, slug: content.slug, name: content.name, content, isActive: true, sortOrder: i, isTemplate: true };
}

const LIBRARY = DEFAULT_SCOPE_TEMPLATES.map(loaded);

const TIER_II: ProposalQuote = {
  arrangement: 'retainer',
  tierLabel: 'Tier II',
  monthlyFee: 15000,
  retainerHours: 6,
  initialFeeMonths: 6,
  initialFee: 90000,
};

/**
 * The prefix a firm on the bundled default set gets. Which symbol appears is
 * the typeface set's decision, not this module's — see `pesoSymbol` in
 * lib/pdf/fonts.ts — so the cases below fix one and the choice itself is
 * asserted separately.
 */
const PESO = '₱';

function build(input: Omit<BuildScopeInput, 'pesoSymbol'>): ProposalSection {
  return buildScopeSection({ ...input, pesoSymbol: PESO });
}

function subheadings(blocks: { kind: string; text?: string }[]): string[] {
  return blocks.filter((b) => b.kind === 'subheading').map((b) => b.text ?? '');
}

function allText(section: ReturnType<typeof buildScopeSection>): string {
  return JSON.stringify(section.blocks);
}

describe('spellCount', () => {
  it('spells numbers below 10 with the figure in parentheses', () => {
    expect(spellCount(3)).toBe('three (3)');
    expect(spellCount(6)).toBe('six (6)');
    expect(spellCount(9)).toBe('nine (9)');
  });

  it('leaves 10 and above as a bare numeral', () => {
    expect(spellCount(10)).toBe('10');
    expect(spellCount(24)).toBe('24');
  });

  it('does not try to spell a fraction', () => {
    expect(spellCount(12.5)).toBe('12.5');
  });
});

describe('token filling', () => {
  it('resolves the hour cap from the quote, not from prose', () => {
    expect(scopeTokens(TIER_II, PESO).retainerHours).toBe('six (6)');
    expect(scopeTokens({ ...TIER_II, tierLabel: 'Tier III', retainerHours: 10 }, PESO).retainerHours).toBe('10');
  });

  it('formats money to the centavo, grouped', () => {
    const t = scopeTokens(TIER_II, PESO);
    expect(t.monthlyFee).toBe('₱15,000.00');
    expect(t.initialFee).toBe('₱90,000.00');
  });

  it('takes the currency prefix from the firm, not from a house rule', () => {
    // A firm on one of the core-PDF-font sets has no ₱ to set — see
    // `hasPesoGlyph` in lib/pdf/fonts.ts. Printing one anyway is a notdef box
    // in a scope line that goes to a client.
    const core = scopeTokens(TIER_II, 'P');
    expect(core.monthlyFee).toBe('P15,000.00');
    expect(core.initialFee).toBe('P90,000.00');
  });

  it('carries that prefix into a filled scope line', () => {
    // A firm whose own scope library states the fee in the line itself.
    const priced = loaded({
      slug: 'priced-retainer',
      name: 'Retainer — priced in the line',
      subheading: 'Retainer Services',
      role: 'service',
      arrangements: ['retainer'],
      autoSelect: false,
      feeScheduleSlugs: [],
      aliases: [],
      blocks: [{ kind: 'para', text: 'The monthly retainer fee is {{monthlyFee}}.' }],
    }, 0);

    const withPeso = buildScopeSection({
      templates: [priced], selectedSlugs: [priced.slug], quote: TIER_II, pesoSymbol: '₱',
    });
    expect(allText(withPeso)).toContain('₱15,000.00');

    const withoutPeso = buildScopeSection({
      templates: [priced], selectedSlugs: [priced.slug], quote: TIER_II, pesoSymbol: 'P',
    });
    expect(allText(withoutPeso)).toContain('P15,000.00');
    expect(allText(withoutPeso)).not.toContain('₱');
  });

  it('marks a figure the quote cannot supply instead of inventing one', () => {
    expect(scopeTokens(null, PESO).retainerHours).toBe(UNRESOLVED);
    expect(scopeTokens({ arrangement: 'fixed' }, PESO).monthlyFee).toBe(UNRESOLVED);
  });

  it('tolerates whitespace in a token and leaves unknown tokens visible', () => {
    expect(fillTokens('up to {{ retainerHours }} hours', { retainerHours: 'six (6)' })).toBe('up to six (6) hours');
    expect(fillTokens('{{mystery}}', {})).toBe('{{mystery}}');
  });
});

describe('buildScopeSection', () => {
  const retainerSlugs = ['retainer-general', 'exclusions-retainer'];

  it('always uses one heading for the section', () => {
    expect(build({ templates: LIBRARY, selectedSlugs: retainerSlugs, quote: TIER_II }).heading)
      .toBe(SCOPE_HEADING);
  });

  it('prints the hour cap the quote supplies', () => {
    const section = build({ templates: LIBRARY, selectedSlugs: retainerSlugs, quote: TIER_II });
    expect(allText(section)).toContain('up to six (6) hours');
    expect(allText(section)).not.toContain('{{');
  });

  it('puts the exclusions clause last, whatever order the slugs arrive in', () => {
    const section = build({
      templates: LIBRARY,
      selectedSlugs: ['exclusions-retainer', 'trademark-prosecution', 'retainer-general'],
      quote: TIER_II,
    });
    const heads = subheadings(section.blocks);
    expect(heads[heads.length - 1]).toBe('Out of Scope');
    expect(heads).toEqual(['Retainer Services', 'Trademark Registration and Maintenance', 'Out of Scope']);
  });

  it('keeps the carve-outs in their own block rather than inside a service paragraph', () => {
    const section = build({ templates: LIBRARY, selectedSlugs: retainerSlugs, quote: TIER_II });
    const carveOut = section.blocks.find(
      (b) => b.kind === 'para' && b.text.startsWith('The following shall be outside the scope'),
    );
    expect(carveOut).toBeDefined();

    const generalSupport = section.blocks.find((b) => b.kind === 'labelled' && b.label === 'General legal support');
    expect(generalSupport).toBeDefined();
    expect(generalSupport && 'text' in generalSupport && generalSupport.text).not.toContain('outside the scope');
  });

  it('prints only one exclusions clause when two are selected', () => {
    const section = build({
      templates: LIBRARY,
      selectedSlugs: ['retainer-general', 'exclusions-retainer', 'exclusions-general'],
      quote: TIER_II,
    });
    expect(subheadings(section.blocks).filter((h) => h === 'Out of Scope')).toHaveLength(1);
  });

  it('places matter-specific lines after the catalogue lines and before the carve-outs', () => {
    const section = build({
      templates: LIBRARY,
      selectedSlugs: retainerSlugs,
      quote: TIER_II,
      bespokeLines: [{
        subheading: 'Trademark Opposition',
        blocks: [{ kind: 'labelled', label: 'Answer to Opposition.', text: 'The Firm will draft and file the Answer.' }],
      }],
    });
    expect(subheadings(section.blocks)).toEqual(['Retainer Services', 'Trademark Opposition', 'Out of Scope']);
  });

  it('opens with the factual background when the matter has one', () => {
    const section = build({
      templates: LIBRARY,
      selectedSlugs: ['exclusions-general'],
      intro: 'The Client has received a demand letter asserting a loan obligation.',
      quote: { arrangement: 'fixed' },
    });
    expect(section.blocks[0]).toEqual({
      kind: 'para',
      text: 'The Client has received a demand letter asserting a loan obligation.',
    });
  });

  it('leaves no leading empty paragraph when there is no background', () => {
    const section = build({ templates: LIBRARY, selectedSlugs: retainerSlugs, intro: '   ', quote: TIER_II });
    expect(section.blocks[0].kind).toBe('subheading');
  });

  it('skips a line the firm has deactivated', () => {
    const deactivated = LIBRARY.map((t) => (t.slug === 'retainer-general' ? { ...t, isActive: false } : t));
    const section = build({ templates: deactivated, selectedSlugs: retainerSlugs, quote: TIER_II });
    expect(subheadings(section.blocks)).toEqual(['Out of Scope']);
  });

  it('surfaces an unresolved figure rather than printing a raw token', () => {
    const section = build({ templates: LIBRARY, selectedSlugs: ['retainer-general'], quote: null });
    expect(allText(section)).not.toContain('{{');
    expect(unresolvedTokens(section)).toBe(true);
  });

  it('reports a fully-resolved section as clean', () => {
    const section = build({ templates: LIBRARY, selectedSlugs: retainerSlugs, quote: TIER_II });
    expect(unresolvedTokens(section)).toBe(false);
  });

  it('fills a token the model put in a matter-specific line', () => {
    // The prompt tells it not to state figures, but braces must never print.
    const section = build({
      templates: LIBRARY,
      selectedSlugs: retainerSlugs,
      quote: TIER_II,
      bespokeLines: [{
        subheading: 'Trademark Opposition',
        blocks: [{ kind: 'para', text: 'Covered within the {{retainerHours}} hours.' }],
      }],
    });
    expect(allText(section)).toContain('six (6) hours');
    expect(allText(section)).not.toContain('{{');
  });

  it('fills a token in a matter-specific subheading too', () => {
    const section = build({
      templates: LIBRARY,
      selectedSlugs: retainerSlugs,
      quote: TIER_II,
      bespokeLines: [{ subheading: '{{tierLabel}} Coverage', blocks: [] }],
    });
    expect(subheadings(section.blocks)).toContain('Tier II Coverage');
  });

  it('flags a token nothing on the quote answers to, rather than printing braces', () => {
    const section = build({
      templates: LIBRARY,
      selectedSlugs: retainerSlugs,
      quote: TIER_II,
      bespokeLines: [{
        subheading: 'Trademark Opposition',
        blocks: [{ kind: 'para', text: 'Billed at {{hourlyRate}} an hour.' }],
      }],
    });
    expect(unresolvedTokens(section)).toBe(true);
  });
});

describe('scheduleSlugsFor', () => {
  it('collects the annexes the selected lines cross-refer, without duplicates', () => {
    expect(scheduleSlugsFor(LIBRARY, ['retainer-general', 'trademark-prosecution']).sort())
      .toEqual(['professional', 'trademark']);
  });

  it('gives every schedule an IP referral names', () => {
    expect(scheduleSlugsFor(LIBRARY, ['ip-filings-referral']).sort())
      .toEqual(['copyright', 'patent', 'trademark']);
  });

  it('never leaves a dispute-resolution offer without its price', () => {
    expect(scheduleSlugsFor(LIBRARY, ['dispute-resolution'])).toContain('professional');
  });
});

describe('defaultScopeSlugs', () => {
  it('starts a retainer off with general support and the retainer carve-outs', () => {
    expect(defaultScopeSlugs(LIBRARY, 'retainer')).toEqual(['retainer-general', 'exclusions-retainer']);
  });

  it('uses the single-matter carve-outs for a one-off engagement', () => {
    expect(defaultScopeSlugs(LIBRARY, 'acceptance_completion')).toEqual(['exclusions-general']);
  });

  it('never seeds two exclusions clauses', () => {
    const slugs = defaultScopeSlugs(LIBRARY, 'retainer', ['retainer', 'litigation']);
    const roles = slugs.map((s) => LIBRARY.find((t) => t.slug === s)!.content.role);
    expect(roles.filter((r) => r === 'exclusions')).toHaveLength(1);
  });

  it('picks up a line the intake named in its own words', () => {
    expect(defaultScopeSlugs(LIBRARY, 'retainer', ['Trademark registration'])).toContain('trademark-prosecution');
    expect(defaultScopeSlugs(LIBRARY, 'retainer', ['litigation'])).toContain('dispute-resolution');
  });

  it('ignores an intake phrase that matches nothing in the catalogue', () => {
    expect(defaultScopeSlugs(LIBRARY, 'retainer', ['Increase in ACS'])).toEqual(['retainer-general', 'exclusions-retainer']);
  });

  it('matches whole words, not fragments inside a longer one', () => {
    // "ip" is an alias of IP Services and sits inside "equipment", which used to
    // pre-select the line — and attach its fee schedule as an annex.
    for (const phrase of ['Equipment leasing', 'Equipment financing', 'Municipal permits']) {
      expect(defaultScopeSlugs(LIBRARY, 'retainer', [phrase])).not.toContain('ip-filings-referral');
    }
  });

  it('still matches the abbreviation when the intake uses it as a word', () => {
    expect(defaultScopeSlugs(LIBRARY, 'retainer', ['IP portfolio'])).toContain('ip-filings-referral');
    expect(defaultScopeSlugs(LIBRARY, 'retainer', ['TM filing'])).toContain('trademark-prosecution');
  });

  it('does not offer a retainer-only line under a different arrangement', () => {
    expect(defaultScopeSlugs(LIBRARY, 'fixed', ['retainer'])).not.toContain('retainer-general');
  });

  it('returns the selection in catalogue order', () => {
    const slugs = defaultScopeSlugs(LIBRARY, 'retainer', ['litigation', 'trademark']);
    const order = slugs.map((s) => LIBRARY.findIndex((t) => t.slug === s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('insertScopeLines', () => {
  const existing = build({
    templates: LIBRARY,
    selectedSlugs: ['retainer-general', 'exclusions-retainer'],
    quote: TIER_II,
  });

  it('places a new service line above the carve-outs', () => {
    const next = insertScopeLines(existing, LIBRARY, ['trademark-prosecution'], TIER_II, PESO);
    expect(subheadings(next.blocks)).toEqual([
      'Retainer Services', 'Trademark Registration and Maintenance', 'Out of Scope',
    ]);
  });

  it('keeps the carve-outs last when several lines are inserted at once', () => {
    const next = insertScopeLines(existing, LIBRARY, ['dispute-resolution', 'trademark-prosecution'], TIER_II, PESO);
    const heads = subheadings(next.blocks);
    expect(heads[heads.length - 1]).toBe('Out of Scope');
    expect(heads).toContain('Dispute Resolution');
    expect(heads).toContain('Trademark Registration and Maintenance');
  });

  it('inserts in catalogue order, not the order the slugs arrived in', () => {
    const next = insertScopeLines(existing, LIBRARY, ['dispute-resolution', 'corporate-advisory'], TIER_II, PESO);
    expect(subheadings(next.blocks)).toEqual([
      'Retainer Services', 'Corporate and Commercial Advisory', 'Dispute Resolution', 'Out of Scope',
    ]);
  });

  it('fills figures from the proposal own quote, not the current schedule', () => {
    // A Custom-tier letter agreed 12.5 hours; inserting a line must not restate
    // whatever the schedule happens to say today.
    const custom = build({
      templates: LIBRARY,
      selectedSlugs: ['exclusions-retainer'],
      quote: { arrangement: 'retainer', tierLabel: 'Custom', retainerHours: 12.5, monthlyFee: 25000 },
    });
    const next = insertScopeLines(custom, LIBRARY, ['retainer-general'], {
      arrangement: 'retainer', tierLabel: 'Custom', retainerHours: 12.5, monthlyFee: 25000,
    }, PESO);
    expect(allText(next)).toContain('up to 12.5 hours');
    expect(allText(next)).not.toContain('{{');
  });

  it('appends when the section has no carve-outs to sit above', () => {
    const bare = { heading: SCOPE_HEADING, blocks: [{ kind: 'para' as const, text: 'Background.' }] };
    const next = insertScopeLines(bare, LIBRARY, ['trademark-prosecution'], TIER_II, PESO);
    expect(next.blocks[0]).toEqual({ kind: 'para', text: 'Background.' });
    expect(subheadings(next.blocks)).toEqual(['Trademark Registration and Maintenance']);
  });

  it('does not add a second carve-out clause to a section that has one', () => {
    const next = insertScopeLines(existing, LIBRARY, ['exclusions-general'], TIER_II, PESO);
    expect(subheadings(next.blocks).filter((h) => h === 'Out of Scope')).toHaveLength(1);
    expect(next.blocks).toEqual(existing.blocks);
  });

  it('adds the carve-outs to a section that has none', () => {
    const bare = { heading: SCOPE_HEADING, blocks: [] };
    const next = insertScopeLines(bare, LIBRARY, ['exclusions-retainer'], TIER_II, PESO);
    expect(subheadings(next.blocks)).toEqual(['Out of Scope']);
  });

  it('leaves the section untouched when nothing is selected', () => {
    expect(insertScopeLines(existing, LIBRARY, [], TIER_II, PESO)).toEqual(existing);
  });

  it('ignores a line the firm has since deactivated', () => {
    const deactivated = LIBRARY.map((t) => (t.slug === 'dispute-resolution' ? { ...t, isActive: false } : t));
    const next = insertScopeLines(existing, deactivated, ['dispute-resolution'], TIER_II, PESO);
    expect(next.blocks).toEqual(existing.blocks);
  });

  it('does not mutate the section it was given', () => {
    const before = structuredClone(existing);
    insertScopeLines(existing, LIBRARY, ['trademark-prosecution'], TIER_II, PESO);
    expect(existing).toEqual(before);
  });

  it('reports what is already in the section so the picker can flag duplicates', () => {
    expect(presentSubheadings(existing)).toContain('retainer services');
    expect(presentSubheadings(existing)).toContain('out of scope');
  });

  it('does not print a service line the section already has', () => {
    // The picker marks it "already in this section"; inserting anyway would put
    // the firm's own wording in the letter twice.
    const next = insertScopeLines(existing, LIBRARY, ['retainer-general'], TIER_II, PESO);
    expect(subheadings(next.blocks).filter((h) => h === 'Retainer Services')).toHaveLength(1);
    expect(next.blocks).toEqual(existing.blocks);
  });

  it('still inserts the lines that are new when one of them duplicates', () => {
    const next = insertScopeLines(existing, LIBRARY, ['retainer-general', 'dispute-resolution'], TIER_II, PESO);
    expect(subheadings(next.blocks)).toEqual([
      'Retainer Services', 'Dispute Resolution', 'Out of Scope',
    ]);
  });
});
