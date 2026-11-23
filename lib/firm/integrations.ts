// ── firm_integrations row access ─────────────────────────────────────
//
// The storage layer under lib/firm/features.ts. It knows how to read one
// (firm, feature) row and open its sealed credentials; it does NOT decide
// whether a feature is available — that decision lives in features.ts and is
// expressed exactly once.
//
// Kept separate from features.ts so the integration consumers that need raw
// credentials (lib/microsoft-graph.ts) can import the
// loader without importing the guard that composes their own
// `is*Configured()` predicates.
//
// Service-role: firm_integrations is deny-by-default under RLS, and the flags
// are consulted from cron paths that carry no JWT.

import { cache } from 'react';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { openSecretBag, SealedSecretError } from '@/lib/firm/secrets';

export interface FirmIntegration {
  firmId: string;
  feature: string;
  /** The firm's switch on this integration record. */
  enabled: boolean;
  /** The non-secret half — directory ids, site paths, bot username. */
  config: Record<string, unknown>;
  /**
   * The opened secret half. Empty when the firm supplied none, and also empty
   * when the blob could not be opened — a credential we cannot read is a
   * credential we do not have, so the guard fails closed either way.
   */
  credentials: Record<string, string>;
}

/**
 * Load one integration row. Returns null when the firm has no row for the
 * feature at all — the caller must read that as OFF.
 *
 * React-cached, so several guards in one request share a single read.
 */
export const loadFirmIntegration = cache(
  async (firmId: string, feature: string): Promise<FirmIntegration | null> => {
    const { data, error } = await getServiceDbForFirm(firmId)
      .from('firm_integrations')
      .select('feature, enabled, config, credentials_enc')
      .eq('feature', feature)
      .maybeSingle();

    if (error) throw new Error(`firm_integrations read failed: ${error.message}`);
    if (!data) return null;

    return {
      firmId,
      feature,
      enabled: data.enabled === true,
      config: (data.config ?? {}) as Record<string, unknown>,
      credentials: openCredentials(firmId, feature, data.credentials_enc),
    };
  },
);

/**
 * Every integration row this firm has, keyed by feature. One read for the whole
 * set: the role shells ask about all the keys at once to paint a sidebar, and
 * eleven cached single-row reads is eleven round trips for one nav render.
 *
 * A feature absent from the map has no row, which reads as OFF exactly like
 * {@link loadFirmIntegration} returning null. Cached alongside the single-row
 * loader rather than replacing it — the per-feature guards on cron and Graph
 * paths ask about one key for one firm and should keep costing one row.
 */
export const loadFirmIntegrations = cache(
  async (firmId: string): Promise<Map<string, FirmIntegration>> => {
    const { data, error } = await getServiceDbForFirm(firmId)
      .from('firm_integrations')
      .select('feature, enabled, config, credentials_enc');

    if (error) throw new Error(`firm_integrations read failed: ${error.message}`);

    const rows = (data ?? []) as {
      feature: string;
      enabled: boolean | null;
      config: Record<string, unknown> | null;
      credentials_enc: string | null;
    }[];

    return new Map(
      rows.map((row) => [
        row.feature,
        {
          firmId,
          feature: row.feature,
          enabled: row.enabled === true,
          config: row.config ?? {},
          credentials: openCredentials(firmId, row.feature, row.credentials_enc),
        },
      ]),
    );
  },
);

function openCredentials(
  firmId: string,
  feature: string,
  sealed: string | null,
): Record<string, string> {
  if (!sealed) return {};
  try {
    return openSecretBag(sealed);
  } catch (err) {
    // Never log the blob or anything derived from it — only that this row is
    // unreadable, which is what an operator needs to know after a bad rotation.
    console.error(
      `[firm-integrations] ${firmId}/${feature}: credentials could not be opened — ` +
        `treating the integration as unconfigured. ${
          err instanceof SealedSecretError ? err.message : 'unexpected error'
        }`,
    );
    return {};
  }
}

/** A trimmed string field from the non-secret config, or '' when absent. */
export function integrationConfigString(
  integration: FirmIntegration | null,
  field: string,
): string {
  const value = integration?.config[field];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * True when this firm has declared that the platform env IS its own integration
 * app. Deliberately explicit and per firm: see the comment in
 * supabase/migrations/20260823_firm_integrations.sql for why there is no
 * implicit fallback.
 */
export function usesPlatformEnv(integration: FirmIntegration | null): boolean {
  return integration?.config.usePlatformEnv === true;
}
