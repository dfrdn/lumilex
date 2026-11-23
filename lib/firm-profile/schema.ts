import { z } from 'zod';
import type { FirmProfileContent } from './types';

/** Validates the full CMS document on save. Mirrors `FirmProfileContent`. */
const teamMember = z.object({
  name: z.string().max(160),
  title: z.string().max(160),
  bio: z.string().max(4000).optional().default(''),
  photoUrl: z.string().url().max(1000).optional().or(z.literal('')),
});

const teamGroup = z.object({
  label: z.string().max(120),
  layout: z.enum(['list', 'grid']),
  members: z.array(teamMember).max(60),
});

export const firmProfileContentSchema: z.ZodType<FirmProfileContent> = z.object({
  cover: z.object({
    firmName: z.string().max(160),
    fullName: z.string().max(200).optional().default(''),
    year: z.string().max(20),
    subtitle: z.string().max(80),
    practiceTags: z.array(z.string().max(80)).max(12),
  }),
  about: z.object({
    heading: z.string().max(120),
    tagline: z.string().max(300),
    paragraphs: z.array(z.string().max(4000)).max(20),
  }),
  practiceAreas: z.object({
    heading: z.string().max(120),
    items: z
      .array(z.object({ title: z.string().max(160), description: z.string().max(2000) }))
      .max(30),
  }),
  team: z.object({
    heading: z.string().max(120),
    groups: z.array(teamGroup).max(20),
    supportLabel: z.string().max(120),
    support: z.array(z.object({ name: z.string().max(160), role: z.string().max(160) })).max(60),
  }),
  glance: z.object({
    heading: z.string().max(120),
    stats: z.array(z.object({ value: z.string().max(40), label: z.string().max(80) })).max(12),
    affiliationsLabel: z.string().max(120),
    affiliations: z.array(z.string().max(300)).max(30),
  }),
  contact: z.object({
    heading: z.string().max(120),
    officeLabel: z.string().max(120),
    addressLines: z.array(z.string().max(200)).max(8),
    phone: z.string().max(120),
    email: z.string().max(200),
    website: z.string().max(200),
  }),
}) as z.ZodType<FirmProfileContent>;

export const firmProfileSaveSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  content: firmProfileContentSchema,
});
