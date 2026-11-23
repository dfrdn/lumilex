import { z } from 'zod';
import { DEMO_PERSONA_KEYS } from '@/lib/demo/personas';

/**
 * Who may open the public demo — pure, so the rule is tested without a
 * database. A visitor gives a name, a work email and a position once, from
 * lumilex.co/demo or from the demo's own sign-in page; the request is stored
 * in `demo_access_requests` (a global table, service-role only) and its id is
 * handed back as a cookie. The one-click sign-in then requires that cookie, so
 * switching roles from the banner does not ask again.
 *
 * The cookie is the row's random id and the route looks it up, so it is not
 * forgeable by guessing and deleting the row revokes it.
 */

export const DEMO_ACCESS_COOKIE = 'lumilex_demo_access';

/** Thirty days: long enough to come back to, short enough to ask again. */
export const DEMO_ACCESS_MAX_AGE = 60 * 60 * 24 * 30;

const text = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(max));

export const demoAccessRequestSchema = z.object({
  name: text(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email().max(254)),
  position: text(120),
  as: z.enum(DEMO_PERSONA_KEYS),
  // Bots fill every field; people never see this one.
  website: z.string().max(0).optional(),
});

export type DemoAccessRequest = z.infer<typeof demoAccessRequestSchema>;

/** Reads a submitted form into a request, or says why it cannot. */
export function parseDemoAccessRequest(
  fields: Record<string, FormDataEntryValue | null | undefined>,
): { ok: true; request: DemoAccessRequest } | { ok: false; fields: string[] } {
  const raw = Object.fromEntries(
    ['name', 'email', 'position', 'as', 'website'].map((k) => {
      const v = fields[k];
      return [k, typeof v === 'string' ? v : undefined];
    }),
  );
  const parsed = demoAccessRequestSchema.safeParse(raw);
  if (parsed.success) return { ok: true, request: parsed.data };
  return { ok: false, fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cookie's value, if it is shaped like a request id at all. */
export function demoAccessId(cookie: string | undefined | null): string | null {
  return cookie && UUID.test(cookie) ? cookie : null;
}
