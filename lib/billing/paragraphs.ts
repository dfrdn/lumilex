/**
 * The billing letter and the billing email, each an ordered list of paragraphs
 * finance owns: they add, rename, reword, reorder and delete them.
 *
 * Every paragraph says when it shows, as a rule over facts about the invoice
 * (`rule`): billed with VAT, owes from earlier billings, the hours went over
 * the retainer cap, an early-payment discount is offered, and so on. A
 * paragraph with a `choice` shows only where finance ticked that choice for the
 * client or the invoice — the letter and the email share a choice by name, so
 * one tick covers both.
 *
 * One paragraph is worded by the app rather than by finance (`system`): what
 * the advance deposit pays and what is left of it. It branches on the
 * settlement's figures, past what one template could say. It sits in the list
 * like any other and can be moved, not edited or deleted.
 *
 * Wording uses the letter's `{{fields}}` (lib/billing/letter-blocks.ts), with
 * `[[ … ]]` around a phrase that drops out when a field in it is blank. Letter
 * paragraphs are stored in the letter markup (**bold**, *italic*); email
 * paragraphs as the editor's HTML.
 */

export type DocumentKind = 'letter' | 'email';

export const FACTS = [
  { key: 'vat', label: 'Billed with VAT' },
  { key: 'expenses', label: 'The bill has out-of-pocket expenses' },
  { key: 'previousBalance', label: 'The client owes from earlier billings' },
  { key: 'advanceCredit', label: 'The client has an advance credit' },
  { key: 'overCap', label: 'The hours went over the retainer cap' },
  { key: 'lessenFees', label: 'The "lessen fees" note is on for the client' },
  { key: 'initialStatement', label: 'It is an initial billing statement' },
  { key: 'moneyOnHand', label: 'The firm holds an advance deposit for the client' },
  { key: 'payable', label: 'Something is left to pay' },
  { key: 'bankDetails', label: 'Bank details are set' },
  { key: 'discount', label: 'An early-payment discount is offered' },
] as const;

export type FactKey = (typeof FACTS)[number]['key'];
export type Facts = Record<FactKey, boolean>;

const FACT_KEYS = new Set<string>(FACTS.map((f) => f.key));

export interface RuleTerm {
  fact: FactKey;
  /** true: shows only when the fact holds; false: only when it doesn't. */
  is: boolean;
}

export type SystemParagraph = 'deposit';

export const SYSTEM_PARAGRAPHS: Record<SystemParagraph, { label: string; when: string }> = {
  deposit: { label: 'Advance deposit', when: 'When the firm holds an advance deposit for the client: what it pays and what is left' },
};

export interface BillingParagraph {
  key: string;
  document: DocumentKind;
  label: string;
  body: string;
  rule: RuleTerm[];
  /** Shows only where this choice is ticked for the client or invoice. */
  choice: string | null;
  system: SystemParagraph | null;
  sortOrder: number;
  archived: boolean;
}

/** A stored rule, read defensively: unknown facts and malformed terms dropped. */
export function readRule(raw: unknown): RuleTerm[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RuleTerm[] = [];
  for (const t of raw) {
    const fact = (t as { fact?: unknown })?.fact;
    const is = (t as { is?: unknown })?.is;
    if (typeof fact !== 'string' || !FACT_KEYS.has(fact) || typeof is !== 'boolean' || seen.has(fact)) continue;
    seen.add(fact);
    out.push({ fact: fact as FactKey, is });
  }
  return out;
}

/** Rows as stored, to paragraphs in their order, deleted ones left out. */
export function readParagraphs(
  rows: { key: string; document: string; label: string | null; body: string; rule: unknown; choice: string | null; system: string | null; sort_order: number | null; archived: boolean | null }[],
  document: DocumentKind,
): BillingParagraph[] {
  return rows
    .filter((r) => r.document === document && !r.archived)
    .map((r) => ({
      key: r.key,
      document,
      label: r.label ?? r.key,
      body: r.body,
      rule: readRule(r.rule),
      choice: r.choice || null,
      system: (r.system === 'deposit' ? r.system : null) as SystemParagraph | null,
      sortOrder: r.sort_order ?? 0,
      archived: false,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Whether a paragraph belongs in this letter or email. */
export function paragraphShows(p: BillingParagraph, facts: Facts, chosen: readonly string[]): boolean {
  if (p.system === 'deposit' && !facts.moneyOnHand) return false;
  if (p.choice && !chosen.includes(p.choice)) return false;
  return p.rule.every((t) => facts[t.fact] === t.is);
}

/** "When the client owes from earlier billings, and not over the retainer cap" — for the editor's list. */
export function describeRule(p: Pick<BillingParagraph, 'rule' | 'choice' | 'system'>, choiceLabel?: string): string {
  if (p.system) return SYSTEM_PARAGRAPHS[p.system].when;
  const parts = p.rule.map((t) => {
    const label = FACTS.find((f) => f.key === t.fact)?.label ?? t.fact;
    return t.is ? label.charAt(0).toLowerCase() + label.slice(1) : `not: ${label.charAt(0).toLowerCase() + label.slice(1)}`;
  });
  if (p.choice) parts.unshift(`ticked for the client (${choiceLabel ?? p.choice})`);
  return parts.length ? `When ${parts.join('; ')}` : 'Every time';
}

const p = (key: string, label: string, body: string, rule: RuleTerm[] = [], extra: Partial<BillingParagraph> = {}): Omit<BillingParagraph, 'sortOrder' | 'document' | 'archived'> => ({
  key, label, body, rule, choice: null, system: null, ...extra,
});

/** The letter's paragraphs as the firm started with them. */
export const DEFAULT_LETTER_PARAGRAPHS: Omit<BillingParagraph, 'sortOrder' | 'document' | 'archived'>[] = [
  p('opening', 'Opening', 'We write to present to you our billing statement for {{period}}[[ pursuant to our Engagement Agreement dated {{engagementDate}}]].', [{ fact: 'initialStatement', is: false }]),
  p('opening-initial', 'Opening — initial statement', 'We write to present to you our initial billing statement[[ pursuant to our Engagement Agreement dated {{engagementDate}}]].', [{ fact: 'initialStatement', is: true }]),
  p('retainer-cap', 'Retainer cap', 'Based on the actual hours worked by our lawyers, the retainer fees for {{period}} could have amounted to {{actualHoursAmount}}. Pursuant to our engagement, however, the first {{retainerHoursCap}} hours of our billable hours are capped at {{retainerCap}} per month.', [{ fact: 'overCap', is: true }]),
  p('lessen-fees', '"Lessen your fees" note', 'To further lessen your fees, we first billed the hours of our more senior lawyers rather than applying the billable hours of our lawyers chronologically.', [{ fact: 'lessenFees', is: true }]),
  p('bill', 'The bill', 'Based on the terms of our agreement, the total {{feesDescription}}{{vatPhrase}} incurred for our services for {{period}} amount to {{total}}.', [{ fact: 'overCap', is: false }]),
  p('bill-after-cap', 'The bill — after the retainer cap', 'In this connection, the total {{feesDescription}}{{vatPhrase}} incurred for our services for {{period}} amount to {{total}}.', [{ fact: 'overCap', is: true }]),
  p('previous-balance', 'Previous balance', 'In addition to your previous {{previousBalanceLabel}} amounting to {{previousBalance}}, your current bill now amounts to **{{totalWithBalance}}**.', [{ fact: 'previousBalance', is: true }]),
  p('advance-credit', 'Advance credit', 'After applying {{previousCredit}}[[ ({{previousBalanceLabel}})]] from your advance deposit against the legal fees, your current bill — net of the deposit and inclusive of out-of-pocket expenses — amounts to **{{totalWithBalance}}**.', [{ fact: 'advanceCredit', is: true }]),
  p('deferred-acceptance-fee', 'Acceptance fee deferred', 'Please note that the Acceptance Fee has not yet been billed, and the billing thereof will be deferred until we are able to review the case records.', [], { choice: 'deferred-acceptance-fee' }),
  p('money-on-hand', SYSTEM_PARAGRAPHS.deposit.label, '', [], { system: 'deposit' }),
  p('breakdown', 'Breakdown', 'Kindly see the attached document for a detailed breakdown of your billing.'),
  p('payment', 'Payment instructions', 'Please transfer the said amount to our {{bankName}} Account No. {{bankAccountNo}} with account name {{bankAccountName}}, on or before {{dueDate}}.', [{ fact: 'payable', is: true }, { fact: 'bankDetails', is: true }]),
  p('payment-no-bank', 'Payment instructions — no bank details', 'Please settle the said amount on or before {{dueDate}}.', [{ fact: 'payable', is: true }, { fact: 'bankDetails', is: false }]),
  p('early-payment', 'Early-payment discount', "Should you settle this statement in full on or before {{discountDeadline}}, we are pleased to extend a discount of {{discountPercent}}% on this month's legal fees, or {{discountAmount}}[[ {{discountVatNote}}]], which reduces the amount to be remitted to **{{discountedAmount}}**.", [{ fact: 'discount', is: true }]),
  p('payment-arrangement', 'Offer a payment arrangement', 'We recognize that the outstanding balance on your account has remained largely unpaid over the last few billing cycles. In this regard, we would be glad to discuss possible payment arrangements that may facilitate the settlement of your account.\n\nWe would appreciate the opportunity to schedule a meeting with you at your earliest convenience. Our goal is to work with you toward a manageable solution so that your ongoing cases will not be adversely affected and our legal services can continue to proceed without interruption.', [], { choice: 'payment-arrangement' }),
  p('closing', 'Closing', 'Should you have any questions as regards the fees, please do not hesitate to contact the undersigned.'),
];

/** A key for a new paragraph from its name, unique among `taken`. */
export function paragraphKey(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'paragraph';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}
