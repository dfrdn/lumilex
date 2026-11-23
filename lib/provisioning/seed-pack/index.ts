/**
 * The seed pack: the neutral starting content `scripts/provision-firm.ts`
 * writes into a new tenant, gathered as one value.
 *
 * Rules every module in this directory holds to, enforced by seed-pack.test.ts:
 *
 *   - **No identity.** No firm name, client, person, address, or contact detail
 *     appears anywhere. A tenant's identity is written by provisioning from its
 *     own config, or left blank for an admin to fill in.
 *   - **No money.** Nothing carries a price a firm did not set. Where a schema
 *     demands a number, the seed omits the row rather than inventing a figure;
 *     where a placeholder is unavoidable (`billing_rates.hourly_rate` is NOT
 *     NULL) it is 0, which is arithmetically obvious rather than plausible.
 *   - **No firm_id.** Rows are stamped at insert by `getServiceDbForFirm`.
 *
 * What is deliberately NOT here:
 *   - `firm_expense_templates` — the firm's own rent, payroll, and vendors.
 *   - `drafting_style_profiles` — derived from the firm's finalized work by
 *     scripts/build-style-profiles.ts, never seeded.
 *   - `transportation_zones` — the firm's own errand geography and costs.
 *   - `ph_holidays`, `rule_sets`, `rule_deadlines` — global tables, already seeded.
 *   - `'placeholder'`-mode document templates — those are DOCX files in the
 *     `templates` bucket, uploaded per firm, not data.
 */

import { SEED_ENUM_OPTIONS } from './enum-options';
import { SEED_BILLING_RATES } from './billing-rates';
import { SEED_FEE_SCHEDULES } from './fee-schedules';
import { SEED_SCOPE_TEMPLATES } from './scope-templates';
import { SEED_DOCUMENT_TEMPLATES } from './document-templates';
import { SEED_EMAIL_TEMPLATES } from './email-templates';
import { SEED_RESOLUTION_TEMPLATES } from './resolution-templates';
import { SEED_FIRM_PROFILE } from './firm-profile';
import type { SeedPack } from './types';

export const SEED_PACK: SeedPack = {
  enumOptions: SEED_ENUM_OPTIONS,
  billingRates: SEED_BILLING_RATES,
  feeSchedules: SEED_FEE_SCHEDULES,
  scopeTemplates: SEED_SCOPE_TEMPLATES,
  documentTemplates: SEED_DOCUMENT_TEMPLATES,
  emailTemplates: SEED_EMAIL_TEMPLATES,
  resolutionTemplates: SEED_RESOLUTION_TEMPLATES,
  firmProfile: SEED_FIRM_PROFILE,
};

/**
 * `resolution_templates.id` is a global text primary key with no `(firm_id, id)`
 * unique behind it, so the catalogue's firm-local keys are namespaced by slug
 * before insert. Without this, seeding a second firm would upsert over the
 * first firm's rows rather than adding its own.
 */
export function resolutionTemplateId(firmSlug: string, key: string): string {
  return `${firmSlug}:${key}`;
}

export * from './types';
export {
  SEED_ENUM_OPTIONS,
  SEED_BILLING_RATES,
  SEED_FEE_SCHEDULES,
  SEED_SCOPE_TEMPLATES,
  SEED_DOCUMENT_TEMPLATES,
  SEED_EMAIL_TEMPLATES,
  SEED_RESOLUTION_TEMPLATES,
  SEED_FIRM_PROFILE,
};
