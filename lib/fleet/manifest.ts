import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * The fleet manifest: every Lumilex instance, one per firm, plus the test
 * project the probe suite runs against. Checked in at fleet/instances.json.
 * It holds no secret — connection strings come from the environment, named by
 * `dbUrlEnvVar(slug)`.
 *
 * Pure. The IO half is scripts/fleet-migrate.ts.
 */

/**
 * Projects that must never receive Lumilex migrations, held as SHA-256 hashes of
 * their refs. The one entry is production of the app Lumilex was forked from: it
 * shares Lumilex's history but not its schema. A hash keeps the guard in a
 * public tree without naming another organisation's project.
 */
export const FORBIDDEN_PROJECT_REF_HASHES: Set<string> = new Set([
  '672a9ac1b1907157e98492b03d4b17dd7a77bb836bc2607386be590ae2cfb527',
]);

export function isForbiddenProjectRef(ref: string): boolean {
  return FORBIDDEN_PROJECT_REF_HASHES.has(createHash('sha256').update(ref).digest('hex'));
}

export const instanceSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}$/, 'lowercase letters, digits and hyphens'),
  role: z.enum(['test', 'firm']),
  supabaseProjectRef: z.string().regex(/^[a-z]{20}$/, 'a 20-letter Supabase project ref'),
  vercelProject: z.string().min(1).nullable(),
  primaryDomain: z.string().min(1).nullable(),
  note: z.string().optional(),
});

export type FleetInstance = z.infer<typeof instanceSchema>;

export const fleetSchema = z
  .object({ instances: z.array(instanceSchema).min(1) })
  .superRefine((fleet, ctx) => {
    const tests = fleet.instances.filter((i) => i.role === 'test');
    if (tests.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: `exactly one instance must have role "test" (found ${tests.length})`,
      });
    }
    const seen = { slug: new Set<string>(), ref: new Set<string>() };
    for (const i of fleet.instances) {
      if (seen.slug.has(i.slug)) {
        ctx.addIssue({ code: 'custom', message: `duplicate slug "${i.slug}"` });
      }
      if (seen.ref.has(i.supabaseProjectRef)) {
        ctx.addIssue({
          code: 'custom',
          message: `project ${i.supabaseProjectRef} is listed twice — one project holds one firm`,
        });
      }
      if (isForbiddenProjectRef(i.supabaseProjectRef)) {
        ctx.addIssue({
          code: 'custom',
          message: `${i.slug}: ${i.supabaseProjectRef} is the origin app's production project and must never receive Lumilex migrations`,
        });
      }
      seen.slug.add(i.slug);
      seen.ref.add(i.supabaseProjectRef);
    }
  });

export type Fleet = z.infer<typeof fleetSchema>;

/** `acme-law` → `FLEET_DB_URL_ACME_LAW`. */
export function dbUrlEnvVar(slug: string): string {
  return `FLEET_DB_URL_${slug.toUpperCase().replace(/-/g, '_')}`;
}

/**
 * Does this connection string point at this project? Supabase names the
 * project in the host of a direct connection (`db.<ref>.supabase.co`) and in
 * the user of a pooler connection (`postgres.<ref>`). A URL pasted under the
 * wrong env var would otherwise migrate one firm's database as another's.
 */
export function urlMatchesRef(connectionString: string, ref: string): boolean {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return false;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return false;
  const host = url.hostname.toLowerCase();
  const user = decodeURIComponent(url.username).toLowerCase();
  return host === `db.${ref}.supabase.co` || user === `postgres.${ref}`;
}

/** The test project first, then firms in manifest order. */
export function applyOrder(fleet: Fleet): FleetInstance[] {
  return [
    ...fleet.instances.filter((i) => i.role === 'test'),
    ...fleet.instances.filter((i) => i.role === 'firm'),
  ];
}
