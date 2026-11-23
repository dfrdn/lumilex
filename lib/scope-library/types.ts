/**
 * Content model for the scope library — the firm's settled scope-of-services
 * text, stored once and reused verbatim.
 *
 * Section 1 of an engagement proposal used to be written from scratch on every
 * draft. The firm's own boilerplate (the out-of-scope carve-outs, the retainer
 * coverage clause) came back approximately right but placed differently each
 * time, and figures it had no business inventing came back wrong. A scope line
 * that recurs is content, not generation: it lives here, and
 * lib/engagement-proposal/scope.ts assembles it into the letter.
 *
 * The model still writes the parts that genuinely differ — the facts of this
 * matter, the steps this engagement covers — as bespoke lines placed between
 * the catalogue lines and the exclusions.
 *
 * Stored as a single JSONB column on `scope_templates`, one row per line.
 */

import type { ProposalBlock, ProposalQuote } from '@/lib/engagement-proposal/types';

export type ProposalArrangement = ProposalQuote['arrangement'];

/**
 * `service` — a scope line offered to the client, printed in catalogue order.
 * `exclusions` — the carve-out clause, always printed last and never mixed in
 * with the service lines. Keeping it a distinct role is what stops it being
 * buried inside a service paragraph, which is how it drifted before.
 */
export type ScopeTemplateRole = 'service' | 'exclusions';

export interface ScopeTemplateContent {
  /** Stable key the proposal names when it selects this line. */
  slug: string;
  /** Admin-facing name in the library list, e.g. "Retainer — General Support". */
  name: string;
  /** The subheading printed above the line, e.g. "Retainer Services". */
  subheading: string;
  /**
   * The line's body. Reuses the proposal's own block union, so what the CMS
   * stores is exactly what the renderer draws — no second content model.
   * Text may carry the tokens listed in lib/engagement-proposal/scope.ts.
   */
  blocks: ProposalBlock[];
  role: ScopeTemplateRole;
  /**
   * Arrangements this line belongs to. Empty means any — a line only offered
   * under a retainer shouldn't be pre-selected for a one-off litigation brief.
   */
  arrangements: ProposalArrangement[];
  /** Pre-select this line when the arrangement matches. */
  autoSelect: boolean;
  /**
   * Fee schedules that price this line when it falls outside the quoted
   * arrangement. Selecting the line attaches them as Annex "A", which is how
   * the house rule "never leave an offer dangling with no price" stops
   * depending on the model remembering it.
   */
  feeScheduleSlugs: string[];
  /**
   * Intake phrasings that mean this line, matched case-insensitively against
   * `proposed_services` to pre-select it. "Retainer", "monthly retainer".
   */
  aliases: string[];
}

export interface ScopeTemplateRow {
  id: string;
  slug: string;
  name: string;
  content: ScopeTemplateContent;
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoadedScopeTemplate {
  id: string | null;
  slug: string;
  name: string;
  content: ScopeTemplateContent;
  isActive: boolean;
  sortOrder: number;
  /** True when no row exists yet and this is the in-code default. */
  isTemplate: boolean;
}
