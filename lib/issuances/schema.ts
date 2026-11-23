import { z } from 'zod';
import { SOURCE_KEYS } from '@/lib/issuances/sources';

// Shared validation for scraped issuance items. One definition consumed by:
// - app/api/issuances/scrape-batch (external/manual POSTs)
// - lib/issuances/extract (Claude structuring of Firecrawl markdown)
// - lib/issuances/ingest (the write path)
//
// `type` is validated here only for shape (non-empty string); the per-source
// taxonomy check (isValidType) happens at ingest time so a bad type is logged
// as a per-item error rather than failing the whole batch.

export const issuanceItemSchema = z.object({
  type: z.string().min(1).max(120),
  number: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().min(1).max(500),
  subject: z.string().trim().max(500).nullable().optional(),
  date_issued: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
    .nullable()
    .optional(),
  date_effective: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
    .nullable()
    .optional(),
  summary: z.string().max(20000).nullable().optional(),
  full_text: z.string().nullable().optional(),
  source_url: z.string().url().max(1000),
  pdf_url: z.string().url().max(1000).nullable().optional(),
  practice_areas: z.array(z.string()).max(20).optional(),
  tags: z.array(z.string()).max(20).optional(),
  ai_confidence: z.enum(['high', 'medium', 'low']),
  ai_flags: z.array(z.string()).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type IssuanceItem = z.infer<typeof issuanceItemSchema>;

export const issuanceBatchSchema = z.object({
  source: z.enum(SOURCE_KEYS as [string, ...string[]]),
  run_started_at: z.string().datetime().optional(),
  items: z.array(issuanceItemSchema).max(200),
});
