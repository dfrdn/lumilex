import { z } from 'zod';
import type { FeeScheduleContent } from './types';

/** Validates a full fee-schedule document on save. Mirrors `FeeScheduleContent`. */
const cover = z.object({
  firmName: z.string().max(160),
  title: z.string().max(120),
  subtitle: z.string().max(200),
  edition: z.string().max(80),
  footnote: z.string().max(200),
  addressLines: z.array(z.string().max(200)).max(8),
  email: z.string().max(200),
  website: z.string().max(200),
  phone: z.string().max(120),
});

const money = z.number().min(0).max(1_000_000_000);

const professionalBody = z.object({
  kind: z.literal('professional'),
  intro: z.string().max(4000),
  retainer: z.object({
    heading: z.string().max(120),
    paragraphs: z.array(z.string().max(4000)).max(10),
    initialFeeMonths: z.number().int().min(0).max(60),
    tiers: z
      .array(
        z.object({
          label: z.string().max(80),
          hours: z.number().int().min(0).max(1000).nullable(),
          monthlyFee: money.nullable(),
          discountPct: z.number().min(0).max(100).nullable(),
          note: z.string().max(200).optional(),
        }),
      )
      .max(12),
  }),
  hourly: z.object({
    heading: z.string().max(120),
    paragraphs: z.array(z.string().max(4000)).max(10),
    rates: z.array(z.object({ position: z.string().max(120), standard: money })).max(30),
  }),
  acceptance: z.object({
    heading: z.string().max(120),
    paragraphs: z.array(z.string().max(4000)).max(10),
    fees: z.array(z.object({ matter: z.string().max(160), standard: money })).max(30),
  }),
});

const tableBody = z.object({
  kind: z.literal('table'),
  intro: z.string().max(4000).optional(),
  columns: z
    .array(
      z.object({
        label: z.string().max(120),
        sublabel: z.string().max(120).optional(),
        flex: z.number().min(0.1).max(20),
        align: z.enum(['left', 'center']),
      }),
    )
    .min(2)
    .max(8),
  groups: z
    .array(
      z.object({
        label: z.string().max(200),
        rows: z
          .array(
            z.object({
              kind: z.enum(['row', 'subheader']).optional(),
              cells: z.array(z.string().max(400)).max(8),
              indent: z.boolean().optional(),
              cellNotes: z.record(z.string(), z.string().max(120)).optional(),
            }),
          )
          .max(120),
      }),
    )
    .max(30),
});

export const feeScheduleContentSchema: z.ZodType<FeeScheduleContent> = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    // The slug lands in storage paths and filenames for the annex package.
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens'),
  name: z.string().min(1).max(160),
  runningTitle: z.string().max(200),
  year: z.string().max(20),
  cover,
  body: z.discriminatedUnion('kind', [professionalBody, tableBody]),
  notesHeading: z.string().max(120),
  notes: z.array(z.object({ label: z.string().max(160), text: z.string().max(4000) })).max(30),
  footnotes: z.array(z.string().max(600)).max(10),
}) as z.ZodType<FeeScheduleContent>;

export const feeScheduleSaveSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  content: feeScheduleContentSchema,
});
