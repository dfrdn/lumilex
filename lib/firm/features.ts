// ── Per-firm feature guard ───────────────────────────────────────────
//
// The single place the guard matrix is expressed. Modelled on lib/agents/:
// an unregistered feature is disabled, never unrestricted, and the refusal
// lives in a function that won't run rather than in a prompt or a UI check.
//
// A feature is available only when all three levels hold:
//
//   1. platform    — the platform-side prerequisite this feature needs
//                    (isVoyageConfigured(), VAPID keys, …).
//                    For a bring-your-own integration this level is satisfied
//                    by the firm's OWN credentials instead; the platform env
//                    only counts when the firm has explicitly declared
//                    `usePlatformEnv`.
//   2. firm flag   — firms.settings.features[key] === true (the entitlement:
//                    what this firm is signed up for) AND the firm_integrations
//                    row exists with enabled = true (the switch on the
//                    integration record itself). Either half missing is OFF.
//   3. credentials — for a BYO integration, every secret and config field the
//                    integration needs is actually present.
//
// Call sites never re-derive any of that. They call resolveFeature() /
// isFeatureAvailable() / requireFeature() and act on the answer.

import { cache } from 'react';
import { getFirmConfig, type FirmConfig } from '@/lib/firm/config';
import {
  loadFirmIntegration,
  loadFirmIntegrations,
  integrationConfigString,
  usesPlatformEnv,
  type FirmIntegration,
} from '@/lib/firm/integrations';
import {
  FEATURE_KEYS,
  type FeatureFlags,
  type FeatureKey,
} from '@/lib/firm/feature-shape';
import {
  isSharePointConfigured,
  isDocxConvertConfigured,
} from '@/lib/microsoft-graph';
import { isVoyageConfigured } from '@/lib/ai/voyage';
import { isAnthropicConfigured } from '@/lib/ai/anthropic-config';
import { isPushConfigured } from '@/lib/push';
import { isFirecrawlConfigured } from '@/lib/issuances/firecrawl';

/**
 * The key set, the `FeatureFlags` shape and the pure nav-visibility helper live
 * in `feature-shape.ts` so a client component can hold resolved flags without
 * importing this module — everything below reaches node:crypto and web-push
 * through the platform predicates. Re-exported here so server call sites keep
 * one import.
 */
export {
  FEATURE_KEYS,
  AI_FEATURE_KEYS,
  isFeatureKey,
  isAiFeatureKey,
  featuresVisible,
  NO_FEATURES,
  type FeatureKey,
  type AiFeatureKey,
  type FeatureFlags,
} from '@/lib/firm/feature-shape';

export type FeatureReason =
  /** Available. */
  | 'ok'
  /** firms.settings.features says this firm isn't signed up for it. */
  | 'not_entitled'
  /** No firm_integrations row — the same "unregistered means off" rule as agents. */
  | 'not_registered'
  /** The row exists and is switched off. */
  | 'switched_off'
  /** The platform env this feature depends on is absent. */
  | 'platform_unconfigured'
  /** A BYO integration whose own credentials or config are incomplete. */
  | 'credentials_missing'
  /**
   * Available, but the firm's `settings.aiLimits` ceiling for this hour or day
   * is spent. Only ever produced by the AI gate, never by the matrix.
   */
  | 'allowance_spent';

export interface FeatureState {
  key: FeatureKey;
  available: boolean;
  reason: FeatureReason;
}

/** Thrown by {@link requireFeature}. */
export class FeatureDisabledError extends Error {
  readonly state: FeatureState;
  constructor(state: FeatureState) {
    super(`Feature "${state.key}" is not available for this firm (${state.reason}).`);
    this.name = 'FeatureDisabledError';
    this.state = state;
  }
}

// ── The matrix ───────────────────────────────────────────────────────

interface FeatureSpec {
  /**
   * The platform-side prerequisite. For a BYO integration this describes the
   * `usePlatformEnv` path only — a firm running its own app is not held back
   * by the platform lacking env it doesn't use.
   */
  platform: () => boolean;
  /** Secrets the firm must supply in `credentials_enc` when it brings its own. */
  byoSecrets: readonly string[];
  /** Non-secret fields the firm must supply in `config` alongside them. */
  byoConfig: readonly string[];
}

/** Every Graph feature is one Entra app registration: directory + app + secret. */
const GRAPH_SECRETS = ['clientSecret'] as const;
const GRAPH_CONFIG = ['tenantId', 'clientId'] as const;

const FEATURE_SPECS: Record<FeatureKey, FeatureSpec> = {
  // No platform dependency: the portal is this app serving its own routes.
  portal: { platform: () => true, byoSecrets: [], byoConfig: [] },

  sharepoint: {
    platform: () => isSharePointConfigured(),
    byoSecrets: GRAPH_SECRETS,
    // A firm's own site is where its client documents get filed; there is no
    // sane default for it, so it is required rather than derived.
    byoConfig: [...GRAPH_CONFIG, 'spHostname', 'spSitePath'],
  },
  docx_pdf: {
    platform: () => isDocxConvertConfigured(),
    byoSecrets: GRAPH_SECRETS,
    // Conversion round-trips through a real OneDrive account.
    byoConfig: [...GRAPH_CONFIG, 'driveUser'],
  },

  // Platform services: per-request compute or platform-owned keypairs, not a
  // per-firm identity, so nothing here is bring-your-own.
  push: { platform: () => isPushConfigured(), byoSecrets: [], byoConfig: [] },
  // Firecrawl fetches the issuances; Claude extracts them.
  issuances: { platform: () => isFirecrawlConfigured() && isAnthropicConfigured(), byoSecrets: [], byoConfig: [] },
  // The drafting studio grounds every draft in embeddings and writes it with Claude.
  drafting: { platform: () => isVoyageConfigured() && isAnthropicConfigured(), byoSecrets: [], byoConfig: [] },
  // Anthropic only. ANTHROPIC_API_KEY is optional at boot: an instance run
  // without AI has every AI feature report platform_unconfigured.
  red_team: { platform: () => isAnthropicConfigured(), byoSecrets: [], byoConfig: [] },

  // ── The AI group ───────────────────────────────────────────────────
  //
  // Anthropic and Voyage are platform keys, not per-firm identities, so none
  // of these is bring-your-own. What they gate is not a credential but a
  // disclosure: firm content leaving for a third party. See AI_FEATURE_KEYS in
  // feature-shape.ts for why they are four keys and not one.
  ai_analysis: { platform: () => isAnthropicConfigured(), byoSecrets: [], byoConfig: [] },
  ai_search: { platform: () => isVoyageConfigured(), byoSecrets: [], byoConfig: [] },
  ai_assistant: { platform: () => isAnthropicConfigured(), byoSecrets: [], byoConfig: [] },
  ai_client_chat: { platform: () => isAnthropicConfigured(), byoSecrets: [], byoConfig: [] },
};

/** True when this feature is a bring-your-own integration. */
export function isByoFeature(key: FeatureKey): boolean {
  const spec = FEATURE_SPECS[key];
  return spec.byoSecrets.length > 0 || spec.byoConfig.length > 0;
}

export interface FeatureRequirements {
  byo: boolean;
  /** Field names that go in `credentials_enc`, sealed. Never rendered back. */
  secrets: readonly string[];
  /** Field names that go in the non-secret `config` jsonb. */
  config: readonly string[];
}

/**
 * What this feature needs from a firm that brings its own app.
 *
 * Exported for the operator surface, which has to render one input per field.
 * The alternative — the form listing `tenantId`, `clientId`, `clientSecret`
 * itself — would be a second copy of the matrix, and the first symptom of the
 * drift would be an operator filling in every box the UI shows while
 * `evaluateFeature` still answers `credentials_missing`.
 */
export function featureRequirements(key: FeatureKey): FeatureRequirements {
  const spec = FEATURE_SPECS[key];
  return { byo: isByoFeature(key), secrets: spec.byoSecrets, config: spec.byoConfig };
}

/**
 * Level 1's platform half, on its own: is the platform-side prerequisite this
 * feature depends on configured?
 *
 * Exported as the third input `evaluateFeature` needs, for a caller that has
 * already loaded a firm's integration rows and its entitlements. Without it
 * such a caller has to reach for `resolveFeature` per key, which re-reads both
 * — see `resolveFeatureFlags` below, which runs the matrix over one pair of
 * reads precisely this way. This is not a fourth place the rule lives: it
 * returns one spec field and decides nothing.
 */
export function isPlatformConfigured(key: FeatureKey): boolean {
  return FEATURE_SPECS[key].platform();
}

// ── Level 2, on its own ──────────────────────────────────────────────

/**
 * The entitlement half of the firm flag: does this firm's `settings.features`
 * turn the key on? A key absent from the map is false — fail closed.
 *
 * This is one of three levels. Use {@link resolveFeature} unless you genuinely
 * only want the entitlement (e.g. rendering an admin settings form).
 */
export function isFeatureEnabled(config: FirmConfig, key: FeatureKey): boolean {
  return config.features[key] === true;
}

// ── The decision, pure ───────────────────────────────────────────────

export interface FeatureInputs {
  /** isFeatureEnabled(firmConfig, key). */
  entitled: boolean;
  /** The firm_integrations row, or null when there is none. */
  integration: FirmIntegration | null;
  /** spec.platform() — passed in so this stays pure and testable. */
  platformConfigured: boolean;
}

/**
 * The three-level guard, expressed once. Pure: everything it needs is in
 * `inputs`, so the matrix can be tested without a database or an env.
 */
export function evaluateFeature(key: FeatureKey, inputs: FeatureInputs): FeatureState {
  const deny = (reason: FeatureReason): FeatureState => ({ key, available: false, reason });

  if (!inputs.entitled) return deny('not_entitled');

  const integration = inputs.integration;
  if (!integration) return deny('not_registered');
  if (!integration.enabled) return deny('switched_off');

  const spec = FEATURE_SPECS[key];

  // Not a BYO integration, or the firm declared the platform app as its own:
  // the platform env is the credential.
  if (!isByoFeature(key) || usesPlatformEnv(integration)) {
    return inputs.platformConfigured
      ? { key, available: true, reason: 'ok' }
      : deny('platform_unconfigured');
  }

  const missing = [
    ...spec.byoSecrets.filter((name) => !integration.credentials[name]?.trim()),
    ...spec.byoConfig.filter((name) => !integrationConfigString(integration, name)),
  ];
  return missing.length === 0
    ? { key, available: true, reason: 'ok' }
    : deny('credentials_missing');
}

// ── The decision, wired ──────────────────────────────────────────────

/** Resolve a feature for a firm. React-cached per request. */
export const resolveFeature = cache(
  async (firmId: string, key: FeatureKey): Promise<FeatureState> => {
    const firm = await getFirmConfig(firmId);
    if (!isFeatureEnabled(firm, key)) {
      return { key, available: false, reason: 'not_entitled' };
    }
    return evaluateFeature(key, {
      entitled: true,
      integration: await loadFirmIntegration(firmId, key),
      platformConfigured: FEATURE_SPECS[key].platform(),
    });
  },
);

export async function isFeatureAvailable(firmId: string, key: FeatureKey): Promise<boolean> {
  return (await resolveFeature(firmId, key)).available;
}

/**
 * Every feature's availability for one firm, in one pair of reads — the firm
 * config and the whole `firm_integrations` set — then the same pure
 * {@link evaluateFeature} per key.
 *
 * This is what a role layout hands to its client shell so the navigation can
 * suppress entries it has no route for. It answers for the full key set rather
 * than a nav-specific subset, so gating a new entry is one field on the nav
 * item and never a second list to keep in sync.
 *
 * Resolving the map does not re-derive the rule: `resolveFeature` is still the
 * answer for a single key, and both run the same matrix.
 */
export const resolveFeatureFlags = cache(async (firmId: string): Promise<FeatureFlags> => {
  const [firm, integrations] = await Promise.all([
    getFirmConfig(firmId),
    loadFirmIntegrations(firmId),
  ]);

  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [
      key,
      evaluateFeature(key, {
        entitled: isFeatureEnabled(firm, key),
        integration: integrations.get(key) ?? null,
        platformConfigured: FEATURE_SPECS[key].platform(),
      }).available,
    ]),
  ) as FeatureFlags;
});

/** Throw unless the feature is available. For handlers that have nothing to return. */
export async function requireFeature(firmId: string, key: FeatureKey): Promise<void> {
  const state = await resolveFeature(firmId, key);
  if (!state.available) throw new FeatureDisabledError(state);
}

/**
 * A skip marker for a cron's per-firm results array. A disabled firm must be
 * visibly skipped, not silently absent — an empty run and a switched-off run
 * look identical from the outside otherwise.
 */
export function featureSkip(state: FeatureState): { skipped: string } {
  return { skipped: `${state.key}: ${state.reason}` };
}
