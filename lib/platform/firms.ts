/**
 * The operator's cross-tenant view of every firm.
 *
 * ── How this stays inside the tenancy model while crossing it ────────
 *
 * The enumeration is the only genuinely cross-tenant read, and it happens on
 * GLOBAL tables — `firms` and `firm_domains` — through the raw service-role
 * client, which is what those tables are for. Everything *inside* a firm is
 * then read through `getServiceDbForFirm(firm.id)`, exactly as any firm-scoped
 * caller would: the facade still pins each query to one firm, still throws on
 * an unregistered table, and the existing rules (`missingInvoiceSettings`,
 * `resolveFeatureFlags`) are called rather than re-derived.
 *
 * So this is N+1 by design, not by accident. A single unscoped sweep of `team`
 * and `firm_integrations` would be one round trip instead of three per firm,
 * and it would also be the first place in the codebase where a tenant table is
 * read with no firm in hand. The operator surface should have to name each
 * tenant it looks at; the loop is what makes it do so. At operator scale (tens
 * of firms, a handful of page loads a day) the cost is irrelevant.
 */
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { resolveFeatureFlags, FEATURE_KEYS } from '@/lib/firm/features';
import type { FeatureKey } from '@/lib/firm/feature-shape';
import { findFirmInvoiceSettings, missingInvoiceSettings } from '@/lib/billing/firm-defaults';
import { firmConfigurationIssues } from '@/lib/platform/firm-issues';
import {
  brandingSchema,
  emailSchema,
  documentsSchema,
  type FirmBranding,
  type FirmSettings,
} from '@/lib/firm/config';
import type { ProvisionConfig } from '@/lib/provisioning/config';
import {
  provisionFirm,
  assertDomainUnclaimed,
  ProvisionError,
  type ProvisionResult,
} from '@/lib/provisioning/provision';

export interface OperatorFirmRow {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  status: string;
  /** The host this firm's people and clients are sent to; null when unmapped. */
  primaryDomain: string | null;
  /** Every host that resolves to this firm, primary included. */
  domainCount: number;
  featuresEnabled: number;
  featuresTotal: number;
  /** false when the firm has no firm_invoice_settings row at all. */
  invoiceSettingsPresent: boolean;
  /** Human labels of the required invoice fields still blank or placeholder. */
  invoiceSettingsMissing: string[];
  activeTeamCount: number;
  createdAt: string;
  /** `settings.demo.enabled` — the public demo, which anyone can sign in to. */
  isDemo: boolean;
  /**
   * What is wrong with this tenant, in the words the operator needs. Empty
   * means nothing found. The rule is `firmConfigurationIssues` in
   * ./firm-issues.ts, which is pure and tested without a database.
   */
  issues: string[];
}

/**
 * Every firm, with enough per-firm state to tell a working tenant from a
 * half-provisioned one. Ordered by name.
 */
export async function listFirmsForOperator(): Promise<OperatorFirmRow[]> {
  const service = getSupabase();

  const [firmsRes, domainsRes] = await Promise.all([
    service
      .from('firms')
      .select('id, slug, name, short_name, status, created_at, settings')
      .order('name'),
    service.from('firm_domains').select('domain, firm_id, is_primary'),
  ]);

  if (firmsRes.error) throw new Error(`firms read failed: ${firmsRes.error.message}`);
  if (domainsRes.error) {
    throw new Error(`firm_domains read failed: ${domainsRes.error.message}`);
  }

  const domains = (domainsRes.data ?? []) as {
    domain: string;
    firm_id: string;
    is_primary: boolean;
  }[];

  const firms = (firmsRes.data ?? []) as {
    id: string;
    slug: string;
    name: string;
    short_name: string;
    status: string;
    created_at: string;
    settings: { demo?: { enabled?: unknown } } | null;
  }[];

  return Promise.all(
    firms.map(async (firm) => {
      const own = domains.filter((d) => d.firm_id === firm.id);

      const [flags, invoiceSettings, teamCount] = await Promise.all([
        resolveFeatureFlags(firm.id),
        findFirmInvoiceSettings(firm.id),
        activeTeamCount(firm.id),
      ]);

      const base = {
        id: firm.id,
        slug: firm.slug,
        name: firm.name,
        shortName: firm.short_name,
        status: firm.status,
        primaryDomain: own.find((d) => d.is_primary)?.domain ?? null,
        domainCount: own.length,
        featuresEnabled: FEATURE_KEYS.filter((key) => flags[key]).length,
        featuresTotal: FEATURE_KEYS.length,
        invoiceSettingsPresent: invoiceSettings !== null,
        invoiceSettingsMissing: invoiceSettings ? missingInvoiceSettings(invoiceSettings) : [],
        activeTeamCount: teamCount,
        createdAt: firm.created_at,
      };

      return {
        ...base,
        isDemo: firm.settings?.demo?.enabled === true,
        issues: firmConfigurationIssues(base),
      };
    }),
  );
}

async function activeTeamCount(firmId: string): Promise<number> {
  const { count, error } = await getServiceDbForFirm(firmId)
    .from('team')
    .select('person_id', { count: 'exact', head: true })
    .eq('active', true);

  if (error) throw new Error(`team count failed for ${firmId}: ${error.message}`);
  return count ?? 0;
}

// ── The write side ───────────────────────────────────────────────────
//
// Everything below writes a GLOBAL table — `firms` or `firm_domains` — which
// is why it lives in this file rather than beside the per-firm editors in
// firm-detail.ts. That module is scoped by `getServiceDbForFirm` and reaches
// for no raw client at all; this one is on the eslint allowlist, and keeping
// the raw client inside it is what stops the allowlist needing a third entry.
//
// None of these functions audit. The route does, because the audit row wants
// the operator, the request IP and the before/after values, and a helper that
// logged on its own would log twice the moment a route composed two of them.

/** A firm as the detail page's header renders it. Null when the id is unknown. */
export interface OperatorFirmIdentity {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  status: string;
  createdAt: string;
  branding: FirmBranding;
  email: FirmSettings['email'];
  documents: FirmSettings['documents'];
  features: FirmSettings['features'];
}

/**
 * Every firm's id, cheaply.
 *
 * For an operator action that concerns all tenants at once rather than one:
 * granting or revoking operator access is the only such action today, and it
 * is audited into every firm's log through `logOperatorAuditAcrossFirms`
 * because a new operator is a new person who can read every tenant's
 * configuration. There is deliberately no sentinel "platform" firm to file it
 * under — see the note on `logOperatorAudit`.
 */
export async function allFirmIds(): Promise<string[]> {
  const { data, error } = await getSupabase().from('firms').select('id');
  if (error) throw new Error(`firms read failed: ${error.message}`);
  return (data ?? []).map((f) => f.id as string);
}

export async function findFirmForOperator(firmId: string): Promise<OperatorFirmIdentity | null> {
  const { data, error } = await getSupabase()
    .from('firms')
    .select('id, slug, name, short_name, status, created_at, branding, settings')
    .eq('id', firmId)
    .maybeSingle();

  if (error) throw new Error(`firms read failed: ${error.message}`);
  if (!data) return null;

  const settings = (data.settings ?? {}) as Record<string, unknown>;
  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    shortName: data.short_name as string,
    status: data.status as string,
    createdAt: data.created_at as string,
    branding: brandingSchema.parse(data.branding ?? {}),
    email: emailSchema.parse(settings.email ?? {}),
    documents: documentsSchema.parse(settings.documents ?? {}),
    features: z.record(z.string(), z.boolean()).parse(settings.features ?? {}),
  };
}

/**
 * Create a firm from the operator form.
 *
 * This is `scripts/provision-firm.ts`'s engine, unchanged and uncopied: the
 * same CHECK-pattern validation, the same domain-hijack refusal, the same
 * fill-what-is-absent idempotency, the same deliberately-incomplete invoice
 * row, the same disabled integrations, the same seed pack, the same first
 * admin with orphan cleanup. If this called anything else, the two front doors
 * would disagree about what a valid firm is.
 */
export async function provisionFirmForOperator(
  config: ProvisionConfig,
  adminPassword?: string,
): Promise<ProvisionResult> {
  return provisionFirm(config, { db: getSupabase(), adminPassword });
}

async function updateFirmRow(firmId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabase().from('firms').update(patch).eq('id', firmId);
  if (error) throw new ProvisionError(`firms update failed: ${error.message}`);
}

/** The platform-facing label and the short name the document archive derives from. */
export async function updateFirmIdentity(
  firmId: string,
  values: { name: string; shortName: string },
): Promise<void> {
  await updateFirmRow(firmId, { name: values.name, short_name: values.shortName });
}

/**
 * The whole `branding` jsonb, merged over what is there and re-parsed through
 * `brandingSchema` — the loader's own schema, so nothing can be written that
 * `getFirmConfig` would read back as a default.
 */
export async function updateFirmBranding(
  firmId: string,
  input: unknown,
  current: FirmBranding,
): Promise<FirmBranding> {
  const merged = brandingSchema.parse({ ...current, ...(input as object) });
  await updateFirmRow(firmId, { branding: merged });
  return merged;
}

/**
 * One section of the `settings` jsonb, read-modify-written so a concurrent
 * shape we don't know about survives. The section itself is normalised through
 * its own schema before it lands.
 */
async function updateSettingsSection(
  firmId: string,
  section: 'email' | 'documents' | 'features',
  value: unknown,
): Promise<void> {
  const db = getSupabase();
  const { data, error } = await db
    .from('firms')
    .select('settings')
    .eq('id', firmId)
    .maybeSingle();
  if (error) throw new ProvisionError(`firms read failed: ${error.message}`);
  if (!data) throw new ProvisionError(`Unknown firm: ${firmId}`);

  const settings = (data.settings ?? {}) as Record<string, unknown>;
  await updateFirmRow(firmId, { settings: { ...settings, [section]: value } });
}

export async function updateFirmEmailIdentity(
  firmId: string,
  input: unknown,
): Promise<FirmSettings['email']> {
  const parsed = emailSchema.parse(input);
  await updateSettingsSection(firmId, 'email', parsed);
  return parsed;
}

export async function updateFirmDocumentRoots(
  firmId: string,
  input: unknown,
): Promise<FirmSettings['documents']> {
  const parsed = documentsSchema.parse(input);
  await updateSettingsSection(firmId, 'documents', parsed);
  return parsed;
}

/**
 * The entitlement half of the feature guard — `firms.settings.features`. Level
 * one of three; `lib/firm/features.ts` still decides whether the feature is
 * actually usable, and this only says what the firm is signed up for.
 *
 * An absent key means off, so turning one off deletes the key rather than
 * writing `false`: the map then reads the same way `entitlementMap()` writes it
 * at provisioning.
 */
export async function setFirmEntitlement(
  firmId: string,
  key: FeatureKey,
  entitled: boolean,
): Promise<Record<string, boolean>> {
  const firm = await findFirmForOperator(firmId);
  if (!firm) throw new ProvisionError(`Unknown firm: ${firmId}`);

  const next = { ...firm.features };
  if (entitled) next[key] = true;
  else delete next[key];

  await updateSettingsSection(firmId, 'features', next);
  return next;
}

/**
 * Suspend or reactivate a firm.
 *
 * Be honest about the blast radius: `status` is read in exactly one place today
 * — `forEachActiveFirm` in lib/tenancy/fan-out.ts — so suspending a firm stops
 * every cron fanning out to it (email sync, notifications, summaries, backfills)
 * and nothing else. It does NOT block sign-in, the portal, or any interactive
 * request; `proxy.ts` never reads it. The UI says so rather than implying a
 * kill switch this field is not.
 */
export async function setFirmStatus(
  firmId: string,
  status: 'active' | 'suspended',
): Promise<void> {
  await updateFirmRow(firmId, { status });
}

// ── Domains ──────────────────────────────────────────────────────────

export interface FirmDomainRow {
  domain: string;
  isPrimary: boolean;
}

export async function listFirmDomains(firmId: string): Promise<FirmDomainRow[]> {
  const { data, error } = await getSupabase()
    .from('firm_domains')
    .select('domain, is_primary')
    .eq('firm_id', firmId)
    .order('domain');
  if (error) throw new ProvisionError(`firm_domains read failed: ${error.message}`);
  return (data ?? []).map((r) => ({ domain: r.domain as string, isPrimary: r.is_primary === true }));
}

/**
 * Add a host to a firm. The hijack refusal is the provisioning path's own
 * `assertDomainUnclaimed` — a host resolves to a firm before anyone has
 * authenticated, so taking one from another firm would serve that firm's
 * branding and sign-in under this name.
 *
 * The first domain a firm gets becomes its primary; after that the operator
 * promotes one deliberately.
 */
export async function addFirmDomain(firmId: string, domain: string): Promise<FirmDomainRow> {
  const db = getSupabase();
  const host = domain.trim().toLowerCase();
  await assertDomainUnclaimed(db, host, { firmId });

  const existing = await listFirmDomains(firmId);
  if (existing.some((d) => d.domain === host)) {
    return existing.find((d) => d.domain === host)!;
  }

  const isPrimary = !existing.some((d) => d.isPrimary);
  const { error } = await db
    .from('firm_domains')
    .insert({ domain: host, firm_id: firmId, is_primary: isPrimary });
  if (error) throw new ProvisionError(`firm_domains insert failed: ${error.message}`);

  return { domain: host, isPrimary };
}

/**
 * Remove a host from a firm.
 *
 * Refuses to remove the primary while the firm has other hosts: dropping it
 * would leave the firm with domains but no front door, and silently promoting
 * one of the others would be this function choosing which hostname a firm's
 * clients see. Promote first, then remove. Removing the only domain is allowed
 * — the firm then has none, which the firms list flags.
 */
export async function removeFirmDomain(firmId: string, domain: string): Promise<void> {
  const host = domain.trim().toLowerCase();
  const rows = await listFirmDomains(firmId);
  const row = rows.find((d) => d.domain === host);
  if (!row) throw new ProvisionError(`"${host}" is not one of this firm's domains.`);

  if (row.isPrimary && rows.length > 1) {
    throw new ProvisionError(
      `"${host}" is this firm's primary host and it has ${rows.length - 1} other domain(s).\n` +
        'Make one of those primary first — removing the primary would leave the firm with ' +
        'hosts but no front door, and picking the replacement is not this action\'s call.',
    );
  }

  const { error } = await getSupabase()
    .from('firm_domains')
    .delete()
    .eq('firm_id', firmId)
    .eq('domain', host);
  if (error) throw new ProvisionError(`firm_domains delete failed: ${error.message}`);
}

/**
 * Promote a host to primary.
 *
 * `firm_domains_one_primary` is a partial unique index, so the old primary is
 * cleared first and the new one set second — two statements, because PostgREST
 * has no transaction. If the second fails the firm is briefly left with no
 * primary, which `firmBaseUrl()` handles by falling back to the platform URL
 * and which the firms list flags. That is a recoverable state; a unique
 * violation from setting both at once is not.
 */
export async function setPrimaryFirmDomain(firmId: string, domain: string): Promise<void> {
  const host = domain.trim().toLowerCase();
  const rows = await listFirmDomains(firmId);
  if (!rows.some((d) => d.domain === host)) {
    throw new ProvisionError(`"${host}" is not one of this firm's domains.`);
  }

  const db = getSupabase();
  const { error: clearErr } = await db
    .from('firm_domains')
    .update({ is_primary: false })
    .eq('firm_id', firmId)
    .eq('is_primary', true);
  if (clearErr) throw new ProvisionError(`firm_domains update failed: ${clearErr.message}`);

  const { error } = await db
    .from('firm_domains')
    .update({ is_primary: true })
    .eq('firm_id', firmId)
    .eq('domain', host);
  if (error) throw new ProvisionError(`firm_domains update failed: ${error.message}`);
}
