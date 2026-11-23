import { z } from 'zod';
import type { ScopeTemplateContent } from './types';

/**
 * The block union, kept in step with lib/engagement-proposal/schema.ts — a
 * scope line is stored in the same shape the letter renders, so anything the
 * CMS accepts here must also survive the proposal's own validation.
 */
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

export const scopeTemplateContentSchema: z.ZodType<ScopeTemplateContent> = z.object({
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens'),
  name: z.string().min(1).max(160),
  subheading: z.string().min(1).max(200),
  blocks: z.array(block).min(1).max(40),
  role: z.enum(['service', 'exclusions']),
  // The six values of ProposalArrangement. 'litigation' was missing here while
  // lib/engagement-proposal/schema.ts and the type both carried it, and the
  // `as z.ZodType<ScopeTemplateContent>` cast below hid the gap from tsc: the
  // two shipped dispute-resolution lines could not be saved through the CMS.
  arrangements: z
    .array(z.enum(['retainer', 'hourly', 'acceptance_completion', 'litigation', 'fixed', 'custom']))
    .max(6),
  autoSelect: z.boolean(),
  feeScheduleSlugs: z.array(z.string().max(60)).max(10),
  aliases: z.array(z.string().max(120)).max(20),
}) as z.ZodType<ScopeTemplateContent>;

export const scopeTemplateSaveSchema = z.object({
  content: scopeTemplateContentSchema,
  name: z.string().min(1).max(160).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
