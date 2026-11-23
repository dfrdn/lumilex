/**
 * Drafts an engagement proposal from a prospect's record.
 *
 * The model writes prose and structure only. Every peso figure it is allowed to
 * quote is handed to it from the live fee schedule, and whatever it returns is
 * re-checked by lib/engagement-proposal/quote.ts before a PDF exists. The
 * result lands in the builder for a partner to read and edit — this never
 * produces a document that goes out unreviewed.
 *
 * The scope section is not the model's to write. Recurring service lines and
 * the firm's carve-out clause are assembled from the scope library by
 * lib/engagement-proposal/scope.ts; the model contributes only the matter-
 * specific lines, which is the part that should differ between two letters.
 */

import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { firmPromptContext } from '@/lib/ai/firm-context';
import { getFirmConfig } from '@/lib/firm/config';
import { pesoSymbol, resolveFontSet } from '@/lib/pdf/fonts';
import type { ProfessionalBody } from '@/lib/fee-schedule/types';
import { discounted } from '@/lib/fee-schedule/types';
import type {
  EngagementProposalContent, ProposalFirmContact, ProposalPayment, ProposalQuote,
} from '@/lib/engagement-proposal/types';
import { customRetainerFigures, litigationFiguresFor, retainerFiguresFor } from '@/lib/engagement-proposal/quote';
import type { CustomRetainerFigures } from '@/lib/engagement-proposal/quote';
import { buildScopeSection, scheduleSlugsFor } from '@/lib/engagement-proposal/scope';
import type { LoadedScopeTemplate } from '@/lib/scope-library/types';
import { toolArray } from '@/lib/ai/json-response';

const MODEL = 'claude-sonnet-5';


export interface ProspectContext {
  clientName: string;
  clientFullName?: string | null;
  attnName?: string | null;
  attnTitle?: string | null;
  proposedServices: string[];
  proposedFee?: number | null;
  consultationNotes?: string | null;
  source?: string | null;
  referralSource?: string | null;
  /** Existing clients on the other side, surfaced by the intake conflict check. */
  conflictNames: string[];
}

export interface DraftOptions {
  /** Firm the letter is written for; supplies the model's identity preamble. */
  firmId: string;
  arrangement?: ProposalQuote['arrangement'];
  tierLabel?: string;
  /** `litigation` only: which acceptance fee in the schedule applies. */
  caseType?: string;
  instructions?: string;
  signer: { firmName: string; name: string; position: string };
  /** Fee-schedule slugs available to reference and attach. */
  availableSchedules: { slug: string; name: string }[];
  /** The whole scope library, in catalogue order. */
  scopeTemplates: LoadedScopeTemplate[];
  /** The lines the drafter selected. Their text goes in verbatim. */
  scopeSlugs: string[];
  /**
   * Figures for a tier the schedule leaves to negotiation. Used only when the
   * chosen tier has no priced row — a named tier always wins.
   */
  customFigures?: CustomRetainerFigures;
  /** The firm's cover band, as the profile publishes it today. */
  firmContact: ProposalFirmContact;
  /** How the client pays, as the firm's invoice settings hold it today. */
  payment: ProposalPayment;
  today: string;
}

/**
 * The house style, minus the one rule that is not the house's to make.
 *
 * `peso` is the currency prefix the firm's own typeface set can print — ₱ for a
 * set whose faces carry U+20B1, a bare "P" for the WinAnsi core PDF faces, which
 * would otherwise set a notdef box. The model writes the letter's fee table and
 * fee prose as content, while the fee schedule bound behind it as Annex "A" is
 * formatted at render time by `peso()` in lib/pdf/letterhead.ts. Both read the
 * same decision, so one bound package does not quote the same figure two ways.
 */
function houseStyle(peso: string): string {
  return `
HOUSE STYLE — ENGAGEMENT PROPOSALS

THE DOCUMENT
- The signed proposal IS the engagement agreement. There is no separate engagement letter.
  Never use the words "engagement letter" anywhere. The intro and the "Engagement and term"
  clause must both say that, upon signature, this proposal constitutes the engagement agreement.
- Aim for roughly three pages of letter. Merge related scope items; never repeat a fee point.

LANGUAGE
- Philippine legal English, formal and plain. Active voice. Oxford comma.
- Currency is written "${peso}" — never "PHP", never any other symbol. Two decimals: ${peso}15,000.00.
- Dates are day-month-year: "22 July 2026".
- No archaic words: thereof, hereto, herein, hereinafter, said (as an adjective), aforementioned.
- Numbers below 10 take the word plus a parenthetical numeral — "six (6) hours of legal services
  per month", "three (3) business days". 10 and above take the numeral alone. No parenthetical
  for periods of days/months/years ("30 days' prior written notice"), dates, times, percentages
  ("12% value-added tax"), or currency amounts.
- Refer to the firm as "the Firm" and to the client as "the Client" after first definition.

REQUIRED COMMERCIAL TERMS — a fee section missing any of these is incomplete:
- Fees are exclusive of the 12% value-added tax.
- Out-of-pocket disbursements are billed to the Client at cost.
- Statements of account are payable within 15 days.
- Either party may terminate on 30 days' prior written notice.
- Where a completion or success fee is quoted, it is waived if the transaction does not close.

STRUCTURE
- Section 1 is the scope of services and is ASSEMBLED FOR YOU — do not write it and do not
  return it in "sections". The firm's settled scope lines and its out-of-scope carve-outs are
  inserted from the scope library, listed below under SCOPE LINES ALREADY IN THE LETTER.
- Your contribution to the scope is "custom_scope_lines": the service lines this matter needs
  that no library line covers — the specific steps of this engagement. Use "scope_intro" for a
  short factual opening where the matter needs one (a dispute, a transaction). Leave both empty
  when the library lines already say everything, which is the normal case for a plain retainer.
- Never restate, paraphrase, or contradict a library line. In particular, never write your own
  out-of-scope or exclusions text — the carve-out clause is already in the letter, and a second
  one would conflict with it.
- Never state an hour cap, a monthly fee, or any other figure inside a custom scope line. The
  library lines carry the figures, and they are filled from the checked quote.
- Any service offered outside the quoted arrangement must cross-refer to the fee schedule that
  prices it and say it is billed separately. Never leave an offer dangling with no price.
- The sections you return start at professional fees and billing. Then the standard terms,
  written as "labelled" blocks: Engagement and term, Responsibility for the engagement,
  Conflicts of interest (only when there is one to disclose), Confidentiality. The final
  section is Acceptance. They are numbered from 2 in the rendered letter — do not number them
  yourself.

CONFLICTS
- When an existing client of the Firm appears on the other side, disclose it in the proposal
  itself and NAME that client. The signature then operates as acknowledgment and informed
  consent under the Code of Professional Responsibility and Accountability. Do not promise to
  "inform the client of the outcome" — the disclosure is already being made here.
- When there is no conflict, omit the clause entirely rather than saying there is none.

FACTS
- Never invent facts about the client, the transaction, or the deal. If a fact you would need
  is absent, write the scope generally rather than inventing a specific.
- Quote only the figures supplied to you below. Do not compute new rates or invent amounts.
`;
}

function emitTool(peso: string) {
  return {
    name: 'emit_engagement_proposal',
    description: 'Emit the drafted engagement proposal in the firm\'s house structure.',
    input_schema: {
      type: 'object' as const,
      properties: {
        subject: { type: 'string', description: 'Subject line, e.g. "Engagement Proposal — Retainer Services for Acme Holdings, Inc."' },
        cover_kicker: { type: 'string', description: 'Short label for the cover under "Prepared for", e.g. "Retainer Proposal" or "Engagement Proposal".' },
        salutation: { type: 'string', description: '"Gentlemen/Mesdames:" for a corporate client; "Dear Ms. Surname:" only for a natural person.' },
        intro: {
          type: 'array',
          description: 'Two opening paragraphs: (1) thanks for considering the Firm and what this proposal sets out, referencing that the firm profile is attached as Annex "B"; (2) the validity period and that signature makes this the engagement agreement.',
          items: { type: 'string' },
        },
        scope_intro: {
          type: 'string',
          description:
            'Optional short factual opening for the scope section — what the matter is, in one paragraph. ' +
            'Use it for a dispute or a transaction with facts worth stating. Omit it for a plain retainer.',
        },
        custom_scope_lines: {
          type: 'array',
          description:
            'Matter-specific service lines that no library line covers, e.g. the steps of a particular ' +
            'opposition or negotiation. Empty when the library lines already cover the engagement. ' +
            'Never an exclusions or out-of-scope line — that clause is already in the letter.',
          items: {
            type: 'object',
            properties: {
              subheading: { type: 'string', description: 'The service line\'s subheading, e.g. "Trademark Opposition".' },
              blocks: {
                type: 'array',
                description: 'Usually "labelled" blocks, one per scope point, with a bold lead-in.',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['para', 'labelled', 'list'] },
                    text: { type: 'string' },
                    label: { type: 'string', description: 'Bold lead-in for a labelled block.' },
                    ordered: { type: 'boolean' },
                    items: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['kind'],
                },
              },
            },
            required: ['subheading', 'blocks'],
          },
        },
        sections: {
          type: 'array',
          description:
            'The sections AFTER the scope, in order: professional fees and billing, the standard terms, ' +
            'then acceptance. Do not include a scope section — it is assembled separately.',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: 'Section heading in title case, e.g. "Professional Fees and Billing".' },
              blocks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['para', 'subheading', 'labelled', 'list', 'feeTable'] },
                    text: { type: 'string', description: 'For para, subheading, and labelled blocks.' },
                    label: { type: 'string', description: 'Bold lead-in for a labelled block.' },
                    ordered: { type: 'boolean', description: 'For list blocks: numbered when true.' },
                    items: { type: 'array', items: { type: 'string' }, description: 'For list blocks.' },
                    rows: {
                      type: 'array',
                      description: 'For a feeTable block.',
                      items: {
                        type: 'object',
                        properties: {
                          fee: { type: 'string', description: 'What the fee is, e.g. "Monthly Retainer Fee".' },
                          amount: { type: 'string', description: `The amount as written, e.g. "${peso}15,000.00".` },
                          when: { type: 'string', description: 'When it is billed, e.g. "Monthly, in advance".' },
                        },
                        required: ['fee', 'amount', 'when'],
                      },
                    },
                  },
                  required: ['kind'],
                },
              },
            },
            required: ['heading', 'blocks'],
          },
        },
        closing: {
          type: 'array',
          description: 'One or two short paragraphs before the signature block.',
          items: { type: 'string' },
        },
        recommended_schedule_slugs: {
          type: 'array',
          description:
            'Slugs of any further fee schedules that should be bound as Annex "A". The schedules the ' +
            'selected scope lines cross-refer are attached automatically — add only what they miss.',
          items: { type: 'string' },
        },
      },
      required: ['subject', 'cover_kicker', 'salutation', 'intro', 'sections', 'closing', 'recommended_schedule_slugs'],
    },
  };
}

/** The only figures the model is permitted to quote. */
function feeBrief(body: ProfessionalBody | null, quote: ProposalQuote | null, peso: string): string {
  if (!body) return 'No structured fee schedule is available. Write the fee section from the drafter\'s instructions only, and do not state any figure the instructions do not contain.';

  const lines: string[] = ['THE FIRM\'S CURRENT FEE SCHEDULE — quote from this and nothing else.', '', 'Retainer tiers:'];
  for (const t of body.retainer.tiers) {
    lines.push(
      t.monthlyFee == null
        ? `- ${t.label}: ${t.note ?? 'subject to negotiation'}`
        : `- ${t.label}: ${peso}${t.monthlyFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })} per month, up to ${t.hours} hours of legal services per month, ${t.discountPct}% discount on hourly rates and acceptance fees`,
    );
  }
  lines.push(`- The Initial Fee is ${body.retainer.initialFeeMonths} months of the monthly retainer fee, consumable against retainer fees and hourly charges.`);

  lines.push('', 'Standard hourly rates:');
  for (const r of body.hourly.rates) {
    lines.push(`- ${r.position}: ${peso}${r.standard.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
  }

  lines.push('', 'Acceptance fees (litigation):');
  for (const f of body.acceptance.fees) {
    lines.push(`- ${f.matter}: ${peso}${f.standard.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
  }

  if (quote?.arrangement === 'litigation') {
    lines.push(
      '',
      'THE ARRANGEMENT BEING PROPOSED — acceptance fee, then hourly as the case proceeds, then a completion fee:',
      quote.caseType && quote.acceptanceFee != null
        ? `- acceptance fee for ${quote.caseType.toLowerCase()}: ${peso}${quote.acceptanceFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}, payable on acceptance of the engagement`
        : '- the acceptance fee is the one the schedule sets for this kind of case',
      '- work as the case proceeds is billed at the standard hourly rates above, per timekeeper',
      '- a completion fee falls due on a favourable resolution — judgment, award, or settlement',
      '- state the completion fee ONLY as the drafter\'s instructions give it. If they do not fix it, say it is to be agreed in writing before the case is filed, and quote no figure or percentage for it.',
      '- these fees are quoted IN this proposal: the dispute is the engagement, not something separately engaged later.',
    );
  }

  if (quote?.tierLabel && quote.monthlyFee != null) {
    const tier = body.retainer.tiers.find((t) => t.label === quote.tierLabel);
    lines.push(
      '',
      'THE ARRANGEMENT BEING PROPOSED — these are the exact figures to use:',
      `- ${quote.tierLabel} monthly retainer at ${peso}${quote.monthlyFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })} per month`,
      `- covering up to ${quote.retainerHours} hours of legal services per month`,
      quote.initialFee != null
        ? `- Initial Fee of ${peso}${quote.initialFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}, equivalent to ${quote.initialFeeMonths} months of the monthly retainer fee`
        : '',
      tier?.discountPct
        ? `- hours beyond the cap are billed at the Firm's hourly rates less the ${tier.discountPct}% retained-client discount (partner ${peso}${discounted(body.hourly.rates[0]?.standard ?? 0, tier.discountPct).toLocaleString('en-PH', { minimumFractionDigits: 2 })})`
        : '',
    );
  }

  return lines.filter(Boolean).join('\n');
}

/**
 * What section 1 already says. The model needs this to know what NOT to write:
 * without it, it re-covers general legal support in its own words and writes a
 * second out-of-scope clause that contradicts the firm's.
 */
function scopeBrief(templates: LoadedScopeTemplate[], slugs: string[]): string {
  const chosen = templates.filter((t) => slugs.includes(t.slug) && t.isActive);
  if (!chosen.length) {
    return 'No library scope lines were selected. Write the whole scope as custom_scope_lines, and include an out-of-scope line.';
  }

  const lines: string[] = [
    'SCOPE LINES ALREADY IN THE LETTER — these are inserted verbatim. Do not rewrite, paraphrase,',
    'or contradict them, and do not repeat what they already cover.',
    '',
  ];
  for (const t of chosen) {
    lines.push(`## ${t.content.subheading}${t.content.role === 'exclusions' ? ' (the carve-out clause, printed last)' : ''}`);
    for (const b of t.content.blocks) {
      if (b.kind === 'labelled') lines.push(`- ${b.label} ${b.text}`);
      else if (b.kind === 'para' || b.kind === 'subheading') lines.push(`- ${b.text}`);
      else if (b.kind === 'list') lines.push(...b.items.map((i) => `  · ${i}`));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function prospectBrief(p: ProspectContext, peso: string): string {
  return [
    `Client: ${p.clientFullName || p.clientName}`,
    p.attnName ? `Contact person: ${p.attnName}${p.attnTitle ? `, ${p.attnTitle}` : ''}` : '',
    p.proposedServices.length ? `Services discussed: ${p.proposedServices.join(', ')}` : '',
    p.proposedFee != null ? `Fee discussed at intake: ${peso}${p.proposedFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '',
    p.referralSource ? `Referred by: ${p.referralSource}` : p.source ? `Source: ${p.source}` : '',
    '',
    'Consultation notes:',
    p.consultationNotes?.trim() || '(none recorded)',
    '',
    p.conflictNames.length
      ? `CONFLICT TO DISCLOSE: the Firm already acts for ${p.conflictNames.join(', ')}, who appear on the other side of this prospect's affairs. Draft the "Conflicts of interest" clause naming them.`
      : 'No conflicts were flagged for this prospect. Omit the conflicts clause.',
  ].filter(Boolean).join('\n');
}

interface EmittedProposal {
  subject: string;
  cover_kicker: string;
  salutation: string;
  intro: string[];
  scope_intro?: string;
  custom_scope_lines?: { subheading: string; blocks: Record<string, unknown>[] }[];
  sections: { heading: string; blocks: Record<string, unknown>[] }[];
  closing: string[];
  recommended_schedule_slugs: string[];
}

/**
 * The tool schema asks for an array of paragraphs, but a model that returns a
 * single string instead would be iterated character by character by the
 * renderer's `for (const para of content.intro)`. Coerce before that can happen.
 */
export function asParagraphs(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter((s) => s.trim());
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    const decoded = toolArray(value);
    if (decoded.length) return decoded.map(String).filter((s) => s.trim());
  }
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

/**
 * The tool marks the subject required, but the API does not enforce it and the
 * model sometimes leaves it out — and a proposal without one fails the content
 * schema, so the drafter gets an error in place of an otherwise complete draft.
 */
export function subjectLine(value: unknown, clientName: string): string {
  const subject = typeof value === 'string' ? value.trim() : '';
  return (subject || `Engagement Proposal for ${clientName}`).slice(0, 400);
}

/** Coerce the model's loosely-typed blocks into the discriminated union. */
export function normalizeBlocks(raw: Record<string, unknown>[]): EngagementProposalContent['sections'][number]['blocks'] {
  const out: EngagementProposalContent['sections'][number]['blocks'] = [];
  for (const b of raw ?? []) {
    const kind = String(b.kind ?? 'para');
    if (kind === 'subheading' && b.text) out.push({ kind: 'subheading', text: String(b.text) });
    else if (kind === 'labelled' && b.label) out.push({ kind: 'labelled', label: String(b.label), text: String(b.text ?? '') });
    else if (kind === 'list' && Array.isArray(b.items)) {
      out.push({ kind: 'list', ordered: b.ordered !== false, items: (b.items as unknown[]).map(String) });
    } else if (kind === 'feeTable' && Array.isArray(b.rows)) {
      out.push({
        kind: 'feeTable',
        rows: (b.rows as Record<string, unknown>[]).map((r) => ({
          fee: String(r.fee ?? ''), amount: String(r.amount ?? ''), when: String(r.when ?? ''),
        })),
      });
    } else if (b.text) {
      out.push({ kind: 'para', text: String(b.text) });
    }
  }
  return out;
}

export async function draftEngagementProposal(
  prospect: ProspectContext,
  body: ProfessionalBody | null,
  opts: DraftOptions,
): Promise<EngagementProposalContent> {
  const arrangement = opts.arrangement ?? 'retainer';
  // The prefix an amount is written with is a property of the firm's typeface
  // set, not a house rule: the fee schedules bound behind this letter are
  // formatted by `peso()` off the same decision, so the model is told which one
  // to use rather than being given a fixed symbol that half the sets misprint.
  const config = await getFirmConfig(opts.firmId);
  const peso = pesoSymbol(resolveFontSet(config.branding.fontSet));
  // A priced tier comes off the schedule. A tier the schedule leaves to
  // negotiation takes the drafter's own figures — without them the scope
  // section has no hour cap to state.
  const quote = arrangement === 'litigation'
    ? (body && opts.caseType ? litigationFiguresFor(body, opts.caseType) : null) ?? { arrangement }
    : arrangement !== 'retainer'
      ? { arrangement }
      : (body && opts.tierLabel ? retainerFiguresFor(body, opts.tierLabel) : null)
        ?? (opts.tierLabel && opts.customFigures
          ? customRetainerFigures(opts.tierLabel, opts.customFigures, body?.retainer.initialFeeMonths)
          : null);

  const scheduleList = opts.availableSchedules.map((s) => `- ${s.slug}: ${s.name}`).join('\n');

  const userMessage = [
    '--- PROSPECT ---',
    prospectBrief(prospect, peso),
    '',
    '--- SCOPE ---',
    scopeBrief(opts.scopeTemplates, opts.scopeSlugs),
    '',
    '--- FEES ---',
    feeBrief(body, quote, peso),
    '',
    '--- FEE SCHEDULES AVAILABLE AS ANNEX "A" ---',
    scheduleList,
    '',
    '--- ENGAGEMENT ---',
    `Arrangement: ${arrangement}`,
    `Signing partner: ${opts.signer.name}, ${opts.signer.position}`,
    `Date of the proposal: ${opts.today}`,
    opts.instructions ? `\nDrafter's instructions (these take precedence):\n${opts.instructions}` : '',
    '',
    'Draft the proposal by calling the emit_engagement_proposal tool.',
  ].filter(Boolean).join('\n');

  const claude = await anthropicFor({ firmId: opts.firmId, feature: 'ai_analysis' });
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: `${firmPromptContext(config)}\n\nYou are a senior legal writer. You draft engagement proposals in the firm's settled house style.\n${houseStyle(peso)}`,
    tools: [emitTool(peso)],
    tool_choice: { type: 'tool', name: 'emit_engagement_proposal' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('The drafting model did not return a proposal. Try again, or draft from a blank proposal.');
  }
  const out = toolUse.input as unknown as EmittedProposal;

  // Section 1 is ours, not the model's. If it returned one anyway, drop it —
  // keeping both would print the scope twice.
  const tailSections = toolArray<(typeof out.sections)[number]>(out.sections).filter(
    (s) => !/^\s*(\d+\.?\s*)?scope\b/i.test(String(s.heading ?? '')),
  );

  const scopeSection = buildScopeSection({
    templates: opts.scopeTemplates,
    selectedSlugs: opts.scopeSlugs,
    intro: out.scope_intro,
    bespokeLines: toolArray<NonNullable<typeof out.custom_scope_lines>[number]>(out.custom_scope_lines).map((line) => ({
      subheading: String(line.subheading ?? ''),
      blocks: normalizeBlocks(toolArray(line.blocks)),
    })),
    quote: quote ?? null,
    pesoSymbol: peso,
  });

  // A line that offers separately-priced work brings its own annex, so an offer
  // cannot reach the client without the schedule that prices it.
  const fromScope = scheduleSlugsFor(opts.scopeTemplates, opts.scopeSlugs);
  const recommended = [...new Set([...fromScope, ...toolArray<string>(out.recommended_schedule_slugs)])].filter((slug) =>
    opts.availableSchedules.some((s) => s.slug === slug),
  );

  return {
    date: opts.today,
    privilegeLine: 'Privileged and Confidential',
    client: {
      name: prospect.clientFullName || prospect.clientName,
      attnName: prospect.attnName ?? '',
      attnTitle: prospect.attnTitle ?? '',
      // Anything with a corporate suffix signs through an entity block; the
      // drafter can flip this in the builder for a sole proprietor.
      isCorporate: /\b(inc\.?|corp\.?|corporation|company|co\.|ltd\.?|incorporated|opc|partnership)\b/i.test(
        prospect.clientFullName || prospect.clientName,
      ),
    },
    subject: subjectLine(out.subject, prospect.clientFullName || prospect.clientName),
    salutation: out.salutation || 'Gentlemen/Mesdames:',
    intro: asParagraphs(out.intro),
    validityDays: 30,
    sections: [
      scopeSection,
      ...tailSections.map((s) => ({
        heading: String(s.heading ?? ''),
        blocks: normalizeBlocks(toolArray(s.blocks)),
      })),
    ],
    closing: asParagraphs(out.closing),
    signer: opts.signer,
    quote: quote ?? undefined,
    annexes: {
      feeScheduleSlugs: recommended.length ? recommended : ['professional'],
      includeFirmProfile: true,
    },
    coverKicker: out.cover_kicker || 'Engagement Proposal',
    firmContact: opts.firmContact,
    payment: opts.payment,
  };
}
