/**
 * Provisioning a firm, as one function two callers share.
 *
 * `scripts/provision-firm.ts` was the whole front door and its behaviour — not
 * its convenience — is what matters: slug and invoice prefix checked against
 * the database's own CHECK patterns, a domain already claimed by another firm
 * refused rather than re-pointed, `firm_invoice_settings` written deliberately
 * incomplete, every `firm_integrations` row written disabled, the seed pack
 * inserted only where absent, the first admin created last with orphan cleanup.
 *
 * The operator form at `/platform/firms/new` needs exactly that behaviour. Two
 * implementations of "what a valid firm is" would drift, and the first symptom
 * would be a tenant provisioned through the UI that the script considers
 * malformed — or worse, one whose domain was quietly taken from another firm.
 * So the logic lives here and both callers are thin: the script parses a JSON
 * file and prints, the route parses a request body and audits.
 *
 * ── Injected client, deliberately ────────────────────────────────────
 *
 * Nothing here imports `@/lib/supabase`. The raw service-role client arrives as
 * a parameter, which is what keeps this module off the `no-restricted-imports`
 * allowlist in eslint.config.mjs: it reads the GLOBAL tables (`firms`,
 * `firm_domains`) through whatever client it is handed and every TENANT table
 * through `getServiceDbForFirm(firmId, db)`, so the facade still pins each of
 * those to a named firm. The operator surface's own allowlisted module supplies
 * the client; the script supplies its own.
 *
 * ── Idempotency ─────────────────────────────────────────────────────
 * **Fill what is absent, never overwrite what is present.** A second run must
 * not reset completed bank details to placeholders or switch an enabled
 * integration back off. Every step reads before it writes and reports `created`
 * or `exists`. Nothing in here issues an unconditional upsert.
 *
 * ── Order ───────────────────────────────────────────────────────────
 * Identity first (firms → firm_domains), then the things that hang off a firm
 * id, then the seed pack, then the human. The admin is last on purpose: it is
 * the only step that creates state outside Postgres (an auth.users row), so if
 * anything earlier fails there is nothing to orphan.
 */
import * as crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { mintId } from '@/lib/ids';
import { FEATURE_KEYS } from '@/lib/firm/feature-shape';
import { invoicePlaceholder } from '@/lib/billing/firm-defaults';
import {
  assertMatchesPattern,
  entitlementMap,
  INVOICE_PREFIX_HINT,
  SLUG_HINT,
  type ProvisionConfig,
} from './config';
import { SEED_PACK, resolutionTemplateId } from './seed-pack';

export type StepOutcome = 'created' | 'exists' | 'skipped';

export interface ProvisionStep {
  label: string;
  outcome: StepOutcome;
  detail?: string;
}

/** A refusal with a message written for the operator reading it. */
export class ProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisionError';
  }
}

function fail(message: string): never {
  throw new ProvisionError(message);
}

// ── Pattern pre-flight ───────────────────────────────────────────────

/**
 * The CHECK-constraint regexes, read from the database itself
 * (20260823_provisioning_patterns_rpc.sql). Validating against these rather
 * than a restated regex means a bad slug fails with a readable message, and a
 * constraint the DBA widens does not leave provisioning rejecting input the
 * database would accept.
 */
export async function readProvisioningPatterns(
  db: SupabaseClient,
): Promise<Record<string, string>> {
  const { data, error } = await db.rpc('provisioning_patterns');
  if (error) {
    fail(
      `Could not read the database's constraint patterns: ${error.message}\n` +
        'Apply supabase/migrations/20260823_provisioning_patterns_rpc.sql first.',
    );
  }
  const rows = (data ?? []) as Array<{ name: string; pattern: string }>;
  const patterns = Object.fromEntries(rows.map((r) => [r.name, r.pattern]));
  for (const name of ['firm_slug', 'invoice_prefix']) {
    if (!patterns[name]) fail(`provisioning_patterns() returned no pattern for '${name}'.`);
  }
  return patterns;
}

export interface DomainOwner {
  firmId: string;
  slug: string | null;
  name: string | null;
}

/** Which firm, if any, a hostname already resolves to. */
export async function findDomainOwner(
  db: SupabaseClient,
  domain: string,
): Promise<DomainOwner | null> {
  const { data, error } = await db
    .from('firm_domains')
    .select('domain, firm_id, firms(slug, name)')
    .eq('domain', domain.trim().toLowerCase())
    .maybeSingle();
  if (error) fail(`firm_domains read failed: ${error.message}`);
  if (!data) return null;

  const owner = data.firms as unknown as { slug: string; name: string } | null;
  return { firmId: data.firm_id as string, slug: owner?.slug ?? null, name: owner?.name ?? null };
}

/**
 * A domain maps a hostname to a firm before anyone has authenticated, so a
 * hostname already pointing at another firm is not a typo to work around — it
 * would hand that firm's branding, and its login, to whoever claimed the name.
 * Refuse, loudly, and leave it to a human.
 *
 * `claimant` is the firm the domain is being added for, named either by id (the
 * domains editor, where the firm exists) or by slug (provisioning, where it may
 * not exist yet). The same host already on the same firm is a no-op, not a
 * conflict.
 */
export async function assertDomainUnclaimed(
  db: SupabaseClient,
  domain: string,
  claimant: { firmId?: string; slug?: string },
): Promise<void> {
  const owner = await findDomainOwner(db, domain);
  if (!owner) return;
  if (claimant.firmId && owner.firmId === claimant.firmId) return;
  if (claimant.slug && owner.slug === claimant.slug) return;

  fail(
    `The domain "${domain}" is already claimed by ${
      owner.name ? `"${owner.name}" (slug ${owner.slug})` : `firm ${owner.firmId}`
    }.\n` +
      '  A host maps to a firm before login, so re-pointing it would serve that firm\'s\n' +
      '  branding and sign-in under this one. Provisioning will not do that.\n' +
      '  If the transfer is intended, remove the existing firm_domains row deliberately first.',
  );
}

/**
 * Everything that can be checked before a single row is written: the two CHECK
 * patterns the database will enforce, and the domain-hijack refusal.
 *
 * Exported so `--dry-run` and the create form's pre-flight both get the same
 * answer as the real run — {@link provisionFirm} calls it itself, so no caller
 * can skip it.
 */
export async function validateAgainstDatabase(
  db: SupabaseClient,
  config: ProvisionConfig,
): Promise<void> {
  const patterns = await readProvisioningPatterns(db);
  assertMatchesPattern(config.slug, patterns.firm_slug, 'Firm slug', SLUG_HINT);
  assertMatchesPattern(
    config.invoicePrefix,
    patterns.invoice_prefix,
    'Invoice prefix',
    INVOICE_PREFIX_HINT,
  );
  await assertDomainUnclaimed(db, config.primaryDomain, { slug: config.slug });
}

// ── Steps ────────────────────────────────────────────────────────────

type Recorder = (label: string, outcome: StepOutcome, detail?: string) => void;

async function ensureFirm(
  db: SupabaseClient,
  config: ProvisionConfig,
  record: Recorder,
): Promise<string> {
  const { data: existing, error: readErr } = await db
    .from('firms')
    .select('id, name')
    .eq('slug', config.slug)
    .maybeSingle();
  if (readErr) fail(`firms read failed: ${readErr.message}`);

  if (existing) {
    record('firms', 'exists', `${existing.name} (${existing.id})`);
    return existing.id as string;
  }

  const { data, error } = await db
    .from('firms')
    .insert({
      slug: config.slug,
      name: config.name,
      short_name: config.shortName,
      status: 'active',
      branding: {
        nameLines: config.branding.nameLines,
        documentName: config.branding.documentName,
        tagline: config.branding.tagline,
        // Assets are uploaded per firm after provisioning; blank renders clean
        // empty space, never a stand-in mark and never another firm's.
        logoPath: '',
        logoLightPath: '',
        monogramPath: '',
        monogramLightPath: '',
        palette: config.branding.palette,
        fontSet: config.branding.fontSet,
      },
      settings: {
        email: config.email,
        documents: config.documents,
        features: entitlementMap(config),
      },
    })
    .select('id')
    .single();
  if (error) fail(`firms insert failed: ${error.message}`);

  record('firms', 'created', `${config.name} (${data!.id})`);
  return data!.id as string;
}

async function ensureDomain(
  db: SupabaseClient,
  firmId: string,
  config: ProvisionConfig,
  record: Recorder,
): Promise<void> {
  const { data } = await db
    .from('firm_domains')
    .select('domain, is_primary')
    .eq('domain', config.primaryDomain)
    .maybeSingle();
  if (data) {
    record(
      'firm_domains',
      'exists',
      `${config.primaryDomain}${data.is_primary ? ' (primary)' : ''}`,
    );
    return;
  }

  // One primary per firm is a partial unique index; if the firm already has a
  // different primary, this domain joins as a secondary rather than failing.
  const { data: primary } = await db
    .from('firm_domains')
    .select('domain')
    .eq('firm_id', firmId)
    .eq('is_primary', true)
    .maybeSingle();

  const isPrimary = !primary;
  const { error } = await db
    .from('firm_domains')
    .insert({ domain: config.primaryDomain, firm_id: firmId, is_primary: isPrimary });
  if (error) fail(`firm_domains insert failed: ${error.message}`);

  record(
    'firm_domains',
    'created',
    isPrimary
      ? `${config.primaryDomain} (primary)`
      : `${config.primaryDomain} (secondary — ${primary!.domain} is already primary)`,
  );
}

/**
 * The invoice settings row, written deliberately incomplete.
 *
 * `invoice_prefix` is real, because `allocate_invoice_number()` reads it out of
 * this row to mint a number and there is no sane placeholder for it. Everything
 * that names where money goes is a placeholder, and `getFirmInvoiceSettings()`
 * refuses to return a row carrying one — so invoicing, the proposal's payment
 * block, and the branded letterhead all stop with a message naming the fields,
 * instead of printing an invoice that quietly asks a client to pay nobody.
 *
 * On a re-run this step never touches an existing row. Overwriting completed
 * bank details with placeholders would be worse than anything a failed
 * provisioning run could do.
 */
async function ensureInvoiceSettings(
  db: SupabaseClient,
  firmId: string,
  config: ProvisionConfig,
  record: Recorder,
): Promise<void> {
  const scoped = getServiceDbForFirm(firmId, db);
  const { data } = await scoped
    .from('firm_invoice_settings')
    .select('invoice_prefix')
    .maybeSingle();
  if (data) {
    record(
      'firm_invoice_settings',
      'exists',
      `prefix ${data.invoice_prefix ?? '(unset)'} — left as finance has it`,
    );
    return;
  }

  const { error } = await scoped.from('firm_invoice_settings').insert({
    invoice_prefix: config.invoicePrefix,
    firm_address: invoicePlaceholder('firm address'),
    firm_address2: '',
    firm_tin: invoicePlaceholder('TIN'),
    bank_name: invoicePlaceholder('bank name'),
    bank_account_no: invoicePlaceholder('bank account number'),
    bank_account_name: invoicePlaceholder('bank account name'),
    signer_name: invoicePlaceholder('signer name'),
    updated_by: 'provision-firm',
  });
  if (error) fail(`firm_invoice_settings insert failed: ${error.message}`);

  record(
    'firm_invoice_settings',
    'created',
    `prefix ${config.invoicePrefix}; bank/TIN placeholder — invoicing refuses until finance completes them`,
  );
}

/**
 * Every registered feature, every one disabled. An unregistered feature is off
 * (lib/firm/features.ts), so writing the rows costs nothing and buys the
 * operator a complete switchboard: turn on what the firm bought, once its
 * credentials are in.
 *
 * Never flips an existing row back off — an operator who enabled sharepoint
 * yesterday should not lose it to a re-run today.
 */
async function ensureIntegrations(
  db: SupabaseClient,
  firmId: string,
  record: Recorder,
): Promise<void> {
  const scoped = getServiceDbForFirm(firmId, db);
  const { data, error: readErr } = await scoped
    .from('firm_integrations')
    .select('feature, enabled');
  if (readErr) fail(`firm_integrations read failed: ${readErr.message}`);

  const present = new Map((data ?? []).map((r) => [r.feature as string, r.enabled as boolean]));
  const missing = FEATURE_KEYS.filter((key) => !present.has(key));

  if (missing.length > 0) {
    const { error } = await scoped
      .from('firm_integrations')
      .insert(missing.map((feature) => ({ feature, enabled: false, config: {} })));
    if (error) fail(`firm_integrations insert failed: ${error.message}`);
  }

  const enabled = [...present.entries()].filter(([, on]) => on).map(([key]) => key);
  record(
    'firm_integrations',
    missing.length > 0 ? 'created' : 'exists',
    `${missing.length} registered disabled, ${present.size} already present` +
      (enabled.length > 0 ? ` (enabled: ${enabled.join(', ')} — left on)` : ''),
  );
}

// ── Seed pack ────────────────────────────────────────────────────────

/**
 * Insert only the rows the firm does not have, keyed on whatever makes a row
 * the same row. Every table here is a tenant table, so `getServiceDbForFirm`
 * stamps firm_id and scopes the existence reads.
 */
async function seedPack(
  db: SupabaseClient,
  firmId: string,
  slug: string,
  record: Recorder,
): Promise<void> {
  const scoped = getServiceDbForFirm(firmId, db);

  const insertMissing = async <T extends object>(
    table: string,
    label: string,
    seeds: readonly T[],
    keyOf: (seed: T) => string,
    existingKeys: Set<string>,
    toRow: (seed: T) => Record<string, unknown>,
  ): Promise<void> => {
    const missing = seeds.filter((seed) => !existingKeys.has(keyOf(seed)));
    if (missing.length === 0) {
      record(label, 'exists', `all ${seeds.length} present`);
      return;
    }
    const { error } = await scoped.from(table).insert(missing.map(toRow));
    if (error) fail(`${table} seed failed: ${error.message}`);
    record(label, 'created', `${missing.length} of ${seeds.length}`);
  };

  // enum_options — unique on (firm_id, entity, field, value).
  {
    const { data } = await scoped.from('enum_options').select('entity, field, value');
    const existing = new Set((data ?? []).map((r) => `${r.entity}.${r.field}.${r.value}`));
    await insertMissing(
      'enum_options',
      'enum_options',
      SEED_PACK.enumOptions,
      (s) => `${s.entity}.${s.field}.${s.value}`,
      existing,
      (s) => ({ ...s }),
    );
  }

  // billing_rates — unique on (firm_id, position).
  {
    const { data } = await scoped.from('billing_rates').select('position');
    const existing = new Set((data ?? []).map((r) => r.position as string));
    await insertMissing(
      'billing_rates',
      'billing_rates (placeholder, all 0.00)',
      SEED_PACK.billingRates,
      (s) => s.position,
      existing,
      (s) => ({ ...s }),
    );
  }

  // fee_schedules — unique on (firm_id, slug).
  {
    const { data } = await scoped.from('fee_schedules').select('slug');
    const existing = new Set((data ?? []).map((r) => r.slug as string));
    await insertMissing(
      'fee_schedules',
      'fee_schedules (structure only, unpriced)',
      SEED_PACK.feeSchedules,
      (s) => s.slug,
      existing,
      (s) => ({
        slug: s.slug,
        name: s.name,
        content: s.content,
        is_active: s.is_active,
        sort_order: s.sort_order,
        created_by: 'provision-firm',
      }),
    );
  }

  // scope_templates — unique on (firm_id, slug).
  {
    const { data } = await scoped.from('scope_templates').select('slug');
    const existing = new Set((data ?? []).map((r) => r.slug as string));
    await insertMissing(
      'scope_templates',
      'scope_templates',
      SEED_PACK.scopeTemplates,
      (s) => s.slug,
      existing,
      (s) => ({
        slug: s.slug,
        name: s.name,
        content: s.content,
        is_active: s.is_active,
        sort_order: s.sort_order,
        created_by: 'provision-firm',
      }),
    );
  }

  // document_templates — no natural key beyond the serial id; matched by name
  // within the firm, which is also how seed-template-files.mjs finds a row.
  {
    const { data } = await scoped.from('document_templates').select('name');
    const existing = new Set((data ?? []).map((r) => r.name as string));
    await insertMissing(
      'document_templates',
      'document_templates (AI mode)',
      SEED_PACK.documentTemplates,
      (s) => s.name,
      existing,
      (s) => ({ ...s, created_by: 'provision-firm' }),
    );
  }

  // email_templates — matched by name within the firm.
  {
    const { data } = await scoped.from('email_templates').select('name');
    const existing = new Set((data ?? []).map((r) => r.name as string));
    await insertMissing(
      'email_templates',
      'email_templates',
      SEED_PACK.emailTemplates,
      (s) => s.name,
      existing,
      (s) => ({ ...s, created_by: 'provision-firm' }),
    );
  }

  // resolution_templates — `id` is a GLOBAL text primary key with no
  // (firm_id, id) unique behind it, so the ids are namespaced by firm slug.
  // Seeding the bare catalogue keys would have the second firm's write land on
  // the first firm's rows.
  {
    const { data } = await scoped.from('resolution_templates').select('id');
    const existing = new Set((data ?? []).map((r) => r.id as string));
    await insertMissing(
      'resolution_templates',
      'resolution_templates',
      SEED_PACK.resolutionTemplates,
      (s) => resolutionTemplateId(slug, s.key),
      existing,
      (s) => ({
        id: resolutionTemplateId(slug, s.key),
        name: s.name,
        kind: s.kind,
        category: s.category,
        description: s.description,
        body_template: s.body_template,
        variable_schema: s.variable_schema,
        is_active: s.is_active,
        sort_order: s.sort_order,
      }),
    );
  }

  // firm_profiles — one default per firm (partial unique index).
  {
    const { data } = await scoped.from('firm_profiles').select('id').limit(1).maybeSingle();
    if (data) {
      record('firm_profiles', 'exists', 'left as the firm has it');
    } else {
      const { error } = await scoped.from('firm_profiles').insert({
        name: 'Firm Profile',
        content: SEED_PACK.firmProfile,
        is_default: true,
        created_by: 'provision-firm',
      });
      if (error) fail(`firm_profiles seed failed: ${error.message}`);
      record('firm_profiles', 'created', 'empty — every identity field blank');
    }
  }
}

// ── First admin ──────────────────────────────────────────────────────

function generatePassword(): string {
  // URL-safe, 24 chars, plus a fixed symbol/digit so it clears any policy that
  // demands character classes.
  return `${crypto.randomBytes(18).toString('base64url')}aA1!`;
}

export interface ProvisionedAdmin {
  personId: string;
  email: string;
  /**
   * The generated password, to be shown once and handed over out of band. Null
   * when the caller supplied one, and null when the team row already existed —
   * a re-run never resets a password.
   */
  password: string | null;
}

/**
 * The first admin: an auth user plus the `team` row that binds it to this firm.
 *
 * Orphan cleanup follows app/api/admin/users/route.ts — if the team insert
 * fails, the auth user is deleted, because an auth.users row with no team row
 * is invisible to the app and makes the retry fail on a duplicate email
 * instead of succeeding.
 */
async function ensureAdmin(
  db: SupabaseClient,
  firmId: string,
  config: ProvisionConfig,
  suppliedPassword: string | undefined,
  record: Recorder,
): Promise<ProvisionedAdmin> {
  const scoped = getServiceDbForFirm(firmId, db);
  const email = config.admin.email;

  const { data: existing } = await scoped
    .from('team')
    .select('person_id, auth_user_id, role')
    .eq('email', email)
    .maybeSingle();

  if (existing?.auth_user_id) {
    record('team (first admin)', 'exists', `${email} — role ${existing.role}, password unchanged`);
    return { personId: existing.person_id as string, email, password: null };
  }
  if (existing) {
    fail(
      `A team row for ${email} exists in this firm without an auth user (person_id ${existing.person_id}).\n` +
        '  Bind it with the set-password admin flow rather than provisioning a second identity.',
    );
  }

  const password = suppliedPassword || generatePassword();

  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr) fail(`auth user create failed for ${email}: ${authErr.message}`);

  const personId = mintId('user');
  const initials = config.admin.name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('')
    .slice(0, 2);

  const { error: teamErr } = await scoped.from('team').insert({
    notion_id: personId,
    person_id: personId,
    name: config.admin.name,
    initials,
    email,
    position: config.admin.position,
    role: 'admin',
    active: true,
    auth_user_id: created!.user.id,
    created_time: new Date().toISOString(),
  });

  if (teamErr) {
    await db.auth.admin.deleteUser(created!.user.id);
    fail(
      `team insert failed for ${email}: ${teamErr.message}\n` +
        '  The auth user was deleted so a re-run does not fail on a duplicate email.',
    );
  }

  record('team (first admin)', 'created', `${email} — role admin, person_id ${personId}`);
  return { personId, email, password: suppliedPassword ? null : password };
}

// ── The whole thing ──────────────────────────────────────────────────

export interface ProvisionOptions {
  /**
   * A raw service-role client. Global tables are read and written through it
   * directly; every tenant table goes through `getServiceDbForFirm(firmId, db)`.
   */
  db: SupabaseClient;
  /** Password for the first admin. Omit to have one generated and returned. */
  adminPassword?: string;
  /** Called as each step lands, for the script's running output. */
  onStep?: (step: ProvisionStep) => void;
}

export interface ProvisionResult {
  firmId: string;
  steps: ProvisionStep[];
  admin: ProvisionedAdmin;
}

export async function provisionFirm(
  config: ProvisionConfig,
  options: ProvisionOptions,
): Promise<ProvisionResult> {
  const { db, adminPassword, onStep } = options;

  // Validation is inside the run, not beside it: a caller that forgot to
  // pre-flight must not be the caller that creates a firm with a slug the
  // database will reject halfway through.
  await validateAgainstDatabase(db, config);

  const steps: ProvisionStep[] = [];
  const record: Recorder = (label, outcome, detail) => {
    const step = { label, outcome, detail };
    steps.push(step);
    onStep?.(step);
  };

  const firmId = await ensureFirm(db, config, record);
  await ensureDomain(db, firmId, config, record);
  await ensureInvoiceSettings(db, firmId, config, record);
  await ensureIntegrations(db, firmId, record);
  await seedPack(db, firmId, config.slug, record);
  const admin = await ensureAdmin(db, firmId, config, adminPassword, record);

  return { firmId, steps, admin };
}
