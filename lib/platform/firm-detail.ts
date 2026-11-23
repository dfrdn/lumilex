/**
 * The operator's view *inside* one firm, and the writes that go with it.
 *
 * Everything here is a TENANT table — `firm_invoice_settings`, `firm_integrations`
 * — so everything here goes through `getServiceDbForFirm(firmId)`. This module
 * imports no raw client and is deliberately not on the eslint allowlist: the
 * cross-tenant half of the operator surface is `firms.ts` and it is the only
 * half that needs to be. An operator editing a firm is doing firm-scoped work
 * with an unusual identity, not cross-tenant work.
 *
 * The rules are borrowed, never restated:
 *
 *   - `missingInvoiceSettings()` defines "incomplete" and billing already fails
 *     loudly on exactly that list, so the form shows exactly that list.
 *   - `evaluateFeature()` — the pure core of the guard in lib/firm/features.ts,
 *     the same one `resolveFeature` and `resolveFeatureFlags` run — is the
 *     authority on whether a feature is usable. The
 *     UI shows its `reason`, not a guess derived from the toggle.
 *   - `sealSecretBag` / `openSecretBag` are the only way credentials move. A
 *     stored secret is never rendered back — the operator learns only whether
 *     one is set.
 */
import {
  findFirmInvoiceSettings,
  missingInvoiceSettings,
  isInvoicePlaceholder,
  EMPTY_FIRM_INVOICE_SETTINGS,
  type FirmInvoiceSettings,
} from '@/lib/billing/firm-defaults';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadFirmIntegrations, usesPlatformEnv } from '@/lib/firm/integrations';
import {
  evaluateFeature,
  isPlatformConfigured,
  featureRequirements,
  FEATURE_KEYS,
  type FeatureKey,
  type FeatureReason,
} from '@/lib/firm/features';
import { sealSecretBag } from '@/lib/firm/secrets';

// ── Invoice settings ─────────────────────────────────────────────────

export interface OperatorInvoiceSettings {
  /** False when the firm has no `firm_invoice_settings` row at all. */
  present: boolean;
  settings: FirmInvoiceSettings;
  /** `missingInvoiceSettings()` — blank or still-placeholder required fields. */
  missing: string[];
  /** Which fields are still carrying the provisioning placeholder, by key. */
  placeholderFields: string[];
}

export async function readInvoiceSettings(firmId: string): Promise<OperatorInvoiceSettings> {
  const found = await findFirmInvoiceSettings(firmId);
  const settings = found ?? EMPTY_FIRM_INVOICE_SETTINGS;
  return {
    present: found !== null,
    settings,
    missing: found ? missingInvoiceSettings(found) : [],
    placeholderFields: (Object.keys(settings) as (keyof FirmInvoiceSettings)[]).filter((k) =>
      isInvoicePlaceholder(settings[k] ?? ''),
    ),
  };
}

export async function saveInvoiceSettings(
  firmId: string,
  values: FirmInvoiceSettings,
  updatedBy: string,
): Promise<OperatorInvoiceSettings> {
  const { error } = await getServiceDbForFirm(firmId)
    .from('firm_invoice_settings')
    .upsert(
      {
        firm_address: values.firmAddress,
        firm_address2: values.firmAddress2,
        firm_tin: values.firmTIN,
        bank_name: values.bankName,
        bank_account_no: values.bankAccountNo,
        bank_account_name: values.bankAccountName,
        signer_name: values.signerName,
        invoice_prefix: values.invoicePrefix,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id' },
    );
  if (error) throw new Error(`firm_invoice_settings write failed: ${error.message}`);
  return readInvoiceSettings(firmId);
}

// ── Features and credentials ─────────────────────────────────────────

export interface OperatorFeatureRow {
  key: FeatureKey;
  /** Level 1: `firms.settings.features[key] === true`. */
  entitled: boolean;
  /** Level 2: a `firm_integrations` row exists… */
  registered: boolean;
  /** …and its switch is on. */
  enabled: boolean;
  /** The non-secret half of the row. */
  config: Record<string, unknown>;
  /** True when the firm declared the platform app to be its own. */
  usesPlatformEnv: boolean;
  byo: boolean;
  configFields: readonly string[];
  secretFields: readonly string[];
  /**
   * Which named secrets currently hold a non-empty value. Names only — a
   * stored secret never leaves the server, so the operator sees "set" or "not
   * set" and can replace or clear, never read.
   */
  secretsSet: string[];
  /** The guard's own answer, from `evaluateFeature` — not a re-derivation. */
  available: boolean;
  reason: FeatureReason;
}

/**
 * Every feature for one firm, with the resolved state and the reason it is off.
 *
 * The toggle alone is a lie: a feature can be switched on and still unusable
 * because the firm was never entitled to it, or because the platform env it
 * needs is absent, or because its own credentials are half-filled. So the row
 * carries all three levels and the guard's own verdict over them.
 *
 * The verdict comes from `evaluateFeature` — the pure core `resolveFeature`
 * itself runs — fed the integration row already loaded above and the
 * entitlement already passed in, the same way `resolveFeatureFlags` does it.
 * Calling `resolveFeature` per key instead would re-read the firm config and
 * the integration row eleven times over, and React's `cache` does not dedupe
 * them here: request memoization does not extend to Route Handlers, so in
 * /api/platform/firms/[id]/features — which calls this twice per PATCH —
 * nothing collapses those reads. It also keeps `entitled` and `available`
 * derived from one source rather than two reads that can disagree.
 */
export async function readFeatureRows(
  firmId: string,
  entitlements: Record<string, boolean>,
): Promise<OperatorFeatureRow[]> {
  const integrations = await loadFirmIntegrations(firmId);

  return FEATURE_KEYS.map((key) => {
      const integration = integrations.get(key) ?? null;
      const requirements = featureRequirements(key);
      const state = evaluateFeature(key, {
        entitled: entitlements[key] === true,
        integration,
        platformConfigured: isPlatformConfigured(key),
      });

      return {
        key,
        entitled: entitlements[key] === true,
        registered: integration !== null,
        enabled: integration?.enabled === true,
        config: integration?.config ?? {},
        usesPlatformEnv: usesPlatformEnv(integration),
        byo: requirements.byo,
        configFields: requirements.config,
        secretFields: requirements.secrets,
        secretsSet: Object.entries(integration?.credentials ?? {})
          .filter(([, value]) => value.trim() !== '')
          .map(([name]) => name),
        available: state.available,
        reason: state.reason,
      };
  });
}

/**
 * The plain-English reason a feature is off, in the operator's terms.
 * Pure, so it is testable and so the wording lives in one place.
 */
export function featureReasonText(reason: FeatureReason): string {
  switch (reason) {
    case 'ok':
      return 'Available';
    case 'not_entitled':
      return 'Not entitled — the firm is not signed up for this feature';
    case 'not_registered':
      return 'No firm_integrations row — an unregistered feature is off, never unrestricted';
    case 'switched_off':
      return 'Registered but switched off';
    case 'platform_unconfigured':
      return 'The platform environment this feature depends on is not configured';
    case 'credentials_missing':
      return 'The firm’s own credentials or config for this integration are incomplete';
    case 'allowance_spent':
      return 'The firm’s AI allowance for this hour or day is spent';
  }
}

async function ensureIntegrationRow(firmId: string, key: FeatureKey): Promise<void> {
  const db = getServiceDbForFirm(firmId);
  const { data, error } = await db
    .from('firm_integrations')
    .select('feature')
    .eq('feature', key)
    .maybeSingle();
  if (error) throw new Error(`firm_integrations read failed: ${error.message}`);
  if (data) return;

  // Written disabled, exactly as provisioning writes it: registering an
  // integration is not the same act as switching it on.
  const { error: insertErr } = await db
    .from('firm_integrations')
    .insert({ feature: key, enabled: false, config: {} });
  if (insertErr) throw new Error(`firm_integrations insert failed: ${insertErr.message}`);
}

/** Level 2's second half: the switch on the integration record itself. */
export async function setIntegrationEnabled(
  firmId: string,
  key: FeatureKey,
  enabled: boolean,
): Promise<void> {
  await ensureIntegrationRow(firmId, key);
  const { error } = await getServiceDbForFirm(firmId)
    .from('firm_integrations')
    .update({ enabled })
    .eq('feature', key);
  if (error) throw new Error(`firm_integrations update failed: ${error.message}`);
}

/**
 * The non-secret half of a bring-your-own integration: directory id,
 * application id, SharePoint site, OneDrive user, and the `usePlatformEnv`
 * declaration. Merged over what is there so a partial save doesn't blank a
 * field the form didn't render.
 */
export async function setIntegrationConfig(
  firmId: string,
  key: FeatureKey,
  patch: Record<string, unknown>,
): Promise<void> {
  await ensureIntegrationRow(firmId, key);
  const db = getServiceDbForFirm(firmId);

  const { data, error } = await db
    .from('firm_integrations')
    .select('config')
    .eq('feature', key)
    .maybeSingle();
  if (error) throw new Error(`firm_integrations read failed: ${error.message}`);

  const merged = { ...((data?.config ?? {}) as Record<string, unknown>), ...patch };
  const { error: writeErr } = await db
    .from('firm_integrations')
    .update({ config: merged })
    .eq('feature', key);
  if (writeErr) throw new Error(`firm_integrations update failed: ${writeErr.message}`);
}

/**
 * Store or replace named secrets, sealed.
 *
 * The bag is read, merged and re-sealed so setting one secret does not
 * silently drop another stored beside it, and an empty value
 * removes that name rather than storing an empty string (which `evaluateFeature`
 * would read as missing anyway, but as a value that looks set in this UI).
 *
 * Nothing here returns a plaintext value, and no caller may ask for one:
 * `readFeatureRows` reports names, never values.
 */
export async function setIntegrationSecrets(
  firmId: string,
  key: FeatureKey,
  values: Record<string, string>,
): Promise<void> {
  await ensureIntegrationRow(firmId, key);
  const integrations = await loadFirmIntegrations(firmId);
  const current = integrations.get(key)?.credentials ?? {};

  const merged: Record<string, string> = { ...current };
  for (const [name, value] of Object.entries(values)) {
    if (value.trim() === '') delete merged[name];
    else merged[name] = value;
  }

  const sealed = Object.keys(merged).length > 0 ? sealSecretBag(merged) : null;
  const { error } = await getServiceDbForFirm(firmId)
    .from('firm_integrations')
    .update({ credentials_enc: sealed })
    .eq('feature', key);
  if (error) throw new Error(`firm_integrations update failed: ${error.message}`);
}

/** Drop every stored secret for one integration. */
export async function clearIntegrationSecrets(firmId: string, key: FeatureKey): Promise<void> {
  const { error } = await getServiceDbForFirm(firmId)
    .from('firm_integrations')
    .update({ credentials_enc: null })
    .eq('feature', key);
  if (error) throw new Error(`firm_integrations update failed: ${error.message}`);
}
