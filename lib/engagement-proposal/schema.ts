import { z } from 'zod';
import type { EngagementProposalContent } from './types';

const block = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('para'), text: z.string().max(6000) }),
  z.object({ kind: z.literal('subheading'), text: z.string().max(200) }),
  z.object({ kind: z.literal('labelled'), label: z.string().max(200), text: z.string().max(6000) }),
  z.object({ kind: z.literal('list'), ordered: z.boolean(), items: z.array(z.string().max(2000)).max(40) }),
  z.object({
    kind: z.literal('feeTable'),
    rows: z
      .array(z.object({ fee: z.string().max(200), amount: z.string().max(120), when: z.string().max(300) }))
      .max(20),
  }),
]);

const money = z.number().min(0).max(1_000_000_000_000);

export const engagementProposalContentSchema: z.ZodType<EngagementProposalContent> = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date'),
  privilegeLine: z.string().max(120),
  client: z.object({
    name: z.string().min(1).max(240),
    attnName: z.string().max(200),
    attnTitle: z.string().max(200),
    isCorporate: z.boolean(),
  }),
  subject: z.string().min(1).max(400),
  salutation: z.string().max(120),
  intro: z.array(z.string().max(6000)).max(10),
  validityDays: z.number().int().min(1).max(365),
  sections: z
    .array(z.object({ heading: z.string().max(200), blocks: z.array(block).max(60) }))
    .max(15),
  closing: z.array(z.string().max(6000)).max(10),
  signer: z.object({
    firmName: z.string().max(240),
    name: z.string().max(200),
    position: z.string().max(160),
  }),
  quote: z
    .object({
      arrangement: z.enum(['retainer', 'hourly', 'acceptance_completion', 'litigation', 'fixed', 'custom']),
      tierLabel: z.string().max(80).optional(),
      monthlyFee: money.optional(),
      retainerHours: z.number().min(0).max(1000).optional(),
      initialFeeMonths: z.number().int().min(0).max(60).optional(),
      initialFee: money.optional(),
      acceptanceFee: money.optional(),
      completionFeePct: z.number().min(0).max(100).optional(),
      transactionValue: money.optional(),
      completionFee: money.optional(),
      caseType: z.string().max(120).optional(),
    })
    .optional(),
  annexes: z.object({
    feeScheduleSlugs: z.array(z.string().max(60)).max(10),
    includeFirmProfile: z.boolean(),
  }),
  coverKicker: z.string().max(120),
  firmContact: z
    .object({
      addressLines: z.array(z.string().max(200)).max(8),
      phone: z.string().max(120),
      email: z.string().max(200),
      website: z.string().max(200),
    })
    .optional(),
  payment: z
    .object({
      bankName: z.string().max(160),
      accountName: z.string().max(240),
      accountNo: z.string().max(80),
      tin: z.string().max(160),
      note: z.string().max(1000),
    })
    .optional(),
}) as z.ZodType<EngagementProposalContent>;

/**
 * Who the letter is addressed to. A prospect names an intake; a client the firm
 * already acts for names the client row directly.
 */
export const proposalRecipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prospect'), intakeId: z.number().int().positive() }),
  z.object({ kind: z.literal('client'), clientId: z.string().min(1).max(120) }),
]);

export const proposalDraftSchema = z.object({
  /** Free-text steer from the drafter, e.g. "Tier II retainer plus trademark work". */
  instructions: z.string().max(4000).optional(),
  arrangement: z.enum(['retainer', 'hourly', 'acceptance_completion', 'litigation', 'fixed', 'custom']).optional(),
  /** Scope-library lines to assemble into section 1. Omitted means "use the defaults". */
  scopeSlugs: z.array(z.string().max(60)).max(20).optional(),
  /** Negotiated figures for a tier the schedule prices "subject to negotiation". */
  customFigures: z
    .object({
      retainerHours: z.number().min(0).max(1000).optional(),
      monthlyFee: money.optional(),
      initialFeeMonths: z.number().int().min(0).max(60).optional(),
    })
    .optional(),
  tierLabel: z.string().max(80).optional(),
  /** `litigation` only: which acceptance fee in the schedule applies. */
  caseType: z.string().max(120).optional(),
  attnName: z.string().max(200).optional(),
  attnTitle: z.string().max(200).optional(),
  signerPersonId: z.string().max(80).optional(),
});

export type ProposalDraftInput = z.infer<typeof proposalDraftSchema>;

/** Drafting the first version also has to say who it is for. */
export const proposalCreateSchema = proposalDraftSchema.extend({
  recipient: proposalRecipientSchema,
});

export const proposalSaveSchema = z.object({
  /** Omit to create the first version; pass an id to update that draft in place. */
  id: z.string().uuid().optional(),
  status: z.enum(['draft', 'sent', 'accepted', 'declined', 'superseded']).optional(),
  content: engagementProposalContentSchema,
});
