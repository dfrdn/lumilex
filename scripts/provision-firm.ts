import './load-env';
import './probe-websocket';
import * as fs from 'fs';
import * as path from 'path';
import { getSupabase } from '../lib/supabase';
import { FEATURE_KEYS } from '../lib/firm/feature-shape';
import {
  parseProvisionConfig,
  derivedDocumentRoot,
  ProvisionConfigError,
  type ProvisionConfig,
} from '../lib/provisioning/config';
import { SEED_PACK } from '../lib/provisioning/seed-pack';
import {
  provisionFirm,
  validateAgainstDatabase,
  ProvisionError,
  type ProvisionStep,
  type ProvisionedAdmin,
} from '../lib/provisioning/provision';

/**
 * Operator-run provisioning for a new firm, from a JSON config file.
 *
 *   PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH" \
 *     npx tsx scripts/provision-firm.ts <config.json> [--dry-run]
 *
 * The behaviour lives in lib/provisioning/provision.ts, which the operator
 * form at /platform/firms/new calls too — one definition of what a valid firm
 * is, so the two paths cannot drift. This file is the file-and-console half:
 * read the config, print the plan or the steps, print the first admin's
 * password once.
 *
 * The config file is the operator's record of what a firm was provisioned
 * with — reviewable before it runs, keepable beside the firm's other
 * onboarding paperwork, replayable verbatim. See lib/provisioning/config.ts.
 * No secret is in it: the first admin's password is generated and printed
 * once, or comes from PROVISION_ADMIN_PASSWORD.
 */

function printStep(step: ProvisionStep): void {
  const mark = step.outcome === 'created' ? '+' : step.outcome === 'exists' ? '=' : '·';
  console.log(`  ${mark} ${step.label}${step.detail ? ` — ${step.detail}` : ''}`);
}

function printSummary(
  firmId: string,
  config: ProvisionConfig,
  steps: ProvisionStep[],
  admin: ProvisionedAdmin,
): void {
  const created = steps.filter((s) => s.outcome === 'created').length;
  const existing = steps.filter((s) => s.outcome === 'exists').length;

  console.log('');
  console.log('─'.repeat(72));
  console.log(`  ${config.name}`);
  console.log(`  firm_id  ${firmId}`);
  console.log(`  slug     ${config.slug}`);
  console.log(`  host     ${config.primaryDomain}`);
  console.log(`  invoices ${config.invoicePrefix}-YYYY-MM-NNN`);
  console.log(
    `  archive  ${derivedDocumentRoot(config, 'finance')} · ${derivedDocumentRoot(config, 'corporate')}`,
  );
  console.log(`  ${created} created, ${existing} already present`);

  if (admin.password) {
    console.log('');
    console.log('  FIRST ADMIN PASSWORD (shown once — hand it over out of band):');
    console.log(`    ${admin.email}`);
    console.log(`    ${admin.password}`);
  }

  const entitled = config.features.length > 0 ? config.features.join(', ') : 'none';

  console.log('');
  console.log('  REMAINING MANUAL STEPS — the firm is not usable until these are done:');
  console.log('');
  console.log('  1. Complete the bank details.  Finance → Settings → Firm invoice,');
  console.log('     or /platform → the firm → Invoice settings.');
  console.log('     Address, TIN, bank name, account number, account name, signer are');
  console.log('     placeholders. Invoicing, the proposal payment block and the branded');
  console.log('     letterhead all refuse until they are real. This is deliberate.');
  console.log('');
  console.log('  2. Set the billing rates.  Finance → Settings → Rates.');
  console.log('     Every position is seeded at 0.00. The rate screen updates rows, it does');
  console.log('     not create them, so the seeded rows are what makes it editable at all.');
  console.log('');
  console.log('  3. Price the fee schedules.  Admin → Fee schedules.');
  console.log('     The four schedules ship with structure and no figures, so nothing quotes');
  console.log('     a price this firm has not set. Fill in the cover letterhead too.');
  console.log('');
  console.log(`  4. Enable the features the firm bought.  Entitled: ${entitled}.`);
  console.log(`     All ${FEATURE_KEYS.length} firm_integrations rows are registered and disabled.`);
  console.log('     /platform → the firm → Features shows the resolved state and why each');
  console.log('     one is off. A bring-your-own integration (SharePoint, docx→pdf)');
  console.log('     also needs its own credentials sealed into the row.');
  console.log('');
  console.log('  5. Upload the branding assets.  Logo, reversed-out logo, monogram.');
  console.log('     The palette, document name and font set are set; the marks are not, and');
  console.log('     documents render clean empty space until they are.');
  console.log('');
  console.log(`  6. Point DNS at the app for ${config.primaryDomain}, and add the host to the`);
  console.log('     deployment. The firm_domains row is what resolves it pre-auth; without');
  console.log('     the DNS record and the platform domain, nothing reaches it.');
  console.log('');
  console.log('  7. Fill in the firm profile.  Admin → Firm profile.');
  console.log('     Seeded empty. The engagement proposal binds it as an annex and refuses');
  console.log('     to export while it has no content.');
  console.log('─'.repeat(72));
}

function printPlan(config: ProvisionConfig): void {
  console.log('');
  console.log('  DRY RUN — nothing was written.');
  console.log('');
  console.log(`  firms                  ${config.slug} · ${config.name} · ${config.shortName}`);
  console.log(`  firm_domains           ${config.primaryDomain} (primary)`);
  console.log(`  firm_invoice_settings  prefix ${config.invoicePrefix}, bank/TIN placeholder`);
  console.log(`  firm_integrations      ${FEATURE_KEYS.length} rows, all disabled`);
  console.log(`  enum_options           ${SEED_PACK.enumOptions.length} rows`);
  console.log(`  billing_rates          ${SEED_PACK.billingRates.length} rows at 0.00`);
  console.log(`  fee_schedules          ${SEED_PACK.feeSchedules.length} rows, unpriced`);
  console.log(`  scope_templates        ${SEED_PACK.scopeTemplates.length} rows`);
  console.log(`  document_templates     ${SEED_PACK.documentTemplates.length} rows`);
  console.log(`  email_templates        ${SEED_PACK.emailTemplates.length} rows`);
  console.log(`  resolution_templates   ${SEED_PACK.resolutionTemplates.length} rows, ids ${config.slug}:*`);
  console.log(`  firm_profiles          1 empty profile`);
  console.log(`  team                   ${config.admin.email} as admin`);
  console.log('');
}

// ── Entry point ──────────────────────────────────────────────────────

const USAGE = `Usage: npx tsx scripts/provision-firm.ts <config.json> [--dry-run]

  <config.json>  the firm's provisioning config; see lib/provisioning/config.ts
  --dry-run      validate the config against the live constraints and print the
                 plan without writing anything

  PROVISION_ADMIN_PASSWORD  optional; otherwise one is generated and printed once.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const configPath = args.find((a) => !a.startsWith('--'));

  if (!configPath) {
    console.error(USAGE);
    process.exit(1);
  }

  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) throw new ProvisionError(`No config file at ${resolved}`);

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (err) {
    throw new ProvisionError(`${resolved} is not valid JSON: ${(err as Error).message}`);
  }

  const config = parseProvisionConfig(raw);
  const db = getSupabase();

  if (dryRun) {
    await validateAgainstDatabase(db, config);
    printPlan(config);
    return;
  }

  console.log('');
  console.log(`Provisioning "${config.name}" (${config.slug})`);
  console.log('');

  const { firmId, steps, admin } = await provisionFirm(config, {
    db,
    adminPassword: process.env.PROVISION_ADMIN_PASSWORD || undefined,
    onStep: printStep,
  });

  printSummary(firmId, config, steps, admin);
}

main().catch((err) => {
  console.error('');
  if (err instanceof ProvisionError || err instanceof ProvisionConfigError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  console.error('');
  process.exit(1);
});
