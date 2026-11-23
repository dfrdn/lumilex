import '../load-env';
import '../probe-websocket';
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fleetSchema, FORBIDDEN_PROJECT_REFS } from '../../lib/fleet/manifest';
import { parseProvisionConfig, type ProvisionConfig } from '../../lib/provisioning/config';

/**
 * What every demo script shares: the demo firm's committed config, and the
 * check that the script is pointed at the project that serves it.
 *
 * The scripts under scripts/demo/ create, fill, snapshot and delete a whole
 * firm. They refuse to touch any firm but the one named in firm.json, on any
 * project but the one fleet/instances.json lists for the demo's domain, and a
 * firm that is not marked `settings.demo.enabled` is never deleted or reset.
 */

const ROOT = path.resolve(__dirname, '..', '..');

export const DEMO_CONFIG: ProvisionConfig = parseProvisionConfig(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/demo/firm.json'), 'utf8')),
);

/** The daily and hourly ceiling on model calls for the public demo. */
export const DEMO_AI_LIMITS = { perHour: 40, perDay: 150 };

/** Throws unless SUPABASE_URL is the project the manifest serves the demo from. */
export function assertDemoProject(): string {
  const fleet = fleetSchema.parse(
    JSON.parse(fs.readFileSync(path.join(ROOT, 'fleet/instances.json'), 'utf8')),
  );
  const instance = fleet.instances.find((i) => i.primaryDomain === DEMO_CONFIG.primaryDomain);
  if (!instance) {
    throw new Error(
      `fleet/instances.json lists no instance serving ${DEMO_CONFIG.primaryDomain} — refusing.`,
    );
  }
  const ref = instance.supabaseProjectRef;
  if (FORBIDDEN_PROJECT_REFS.has(ref)) throw new Error(`${ref} is a forbidden project — refusing.`);

  const url = process.env.SUPABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* reported below */
  }
  if (host !== `${ref}.supabase.co`) {
    throw new Error(
      `SUPABASE_URL (${host || 'unset'}) is not the demo's project ${ref} — refusing.`,
    );
  }
  return ref;
}

export interface DemoFirm {
  id: string;
  settings: Record<string, unknown>;
}

/** The demo firm, if it has been provisioned. Verified by slug and primary domain. */
export async function findDemoFirm(db: SupabaseClient): Promise<DemoFirm | null> {
  const { data: firm, error } = await db
    .from('firms')
    .select('id, settings')
    .eq('slug', DEMO_CONFIG.slug)
    .maybeSingle();
  if (error) throw new Error(`firms read failed: ${error.message}`);
  if (!firm) return null;

  const { data: domain } = await db
    .from('firm_domains')
    .select('domain')
    .eq('firm_id', firm.id)
    .eq('is_primary', true)
    .maybeSingle();
  if (domain?.domain !== DEMO_CONFIG.primaryDomain) {
    throw new Error(
      `Firm "${DEMO_CONFIG.slug}" exists but its primary domain is ${domain?.domain ?? 'unset'}, ` +
        `not ${DEMO_CONFIG.primaryDomain} — refusing to treat it as the demo.`,
    );
  }
  return { id: firm.id as string, settings: (firm.settings ?? {}) as Record<string, unknown> };
}

/** Throws unless the firm carries the demo mark. Guards every destructive step. */
export function assertMarkedDemo(firm: DemoFirm): void {
  const demo = firm.settings.demo as { enabled?: unknown } | undefined;
  if (demo?.enabled !== true) {
    throw new Error(
      `Firm ${firm.id} is not marked settings.demo.enabled — refusing a destructive step on it.`,
    );
  }
}
