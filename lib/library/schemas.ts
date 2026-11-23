import { z } from 'zod';
import { USER_ROLES } from '@/lib/roles';
import { HANDBOOK_KINDS } from '@/lib/library/model';

/** A link out of the Library opens in the browser, so only a web address will do. */
const externalUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Use an http or https link');

/** Roles a page is limited to. Unknown values would hide a page from everyone but admins. */
const visibleToRoles = z.array(z.enum(USER_ROLES)).max(USER_ROLES.length);

export const libraryPageCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(HANDBOOK_KINDS),
  content: z.string().max(400_000).default(''),
  summary: z.string().trim().max(600).default(''),
  status: z.enum(['draft', 'published']).default('draft'),
  pinned: z.boolean().default(false),
  external_url: externalUrl.nullable().optional(),
  visible_to_roles: visibleToRoles.nullable().optional(),
});

export const libraryPagePatchSchema = z.object({
  status: z.enum(['draft', 'review', 'published', 'stale', 'archived']).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(400_000).optional(),
  summary: z.string().trim().max(600).optional(),
  kind: z.enum(HANDBOOK_KINDS).optional(),
  pinned: z.boolean().optional(),
  external_url: externalUrl.nullable().optional(),
  visible_to_roles: visibleToRoles.nullable().optional(),
});
