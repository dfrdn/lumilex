/**
 * The scope library a new firm starts with.
 *
 * Source: `DEFAULT_SCOPE_TEMPLATES` in lib/scope-library/default.ts, seeded
 * verbatim. Unlike the fee schedules, this content is already neutral — generic
 * Philippine engagement boilerplate written against "the Client" and "the Firm",
 * naming nobody, and carrying no figures (the hour cap is a `{{retainerHours}}`
 * token precisely so it can never disagree with the tier that priced it).
 *
 * Seeding rather than leaving the table empty changes nothing about what a
 * proposal prints — `loadScopeTemplates()` falls back to the same content per
 * slug — but it makes the lines the firm's own rows, editable in
 * /admin/scope-library and versioned per tenant from the first day rather than
 * silently shared until someone happens to save one.
 *
 * FLAGGED, not decided: this wording was transcribed from one firm's sent
 * proposals. It is identity-free, but whether one firm's negotiated carve-out
 * clause is the right default contract text for every tenant is a product
 * question, not a provisioning one. It is the same open question the rate
 * figures in lib/fee-schedule/default.ts posed before that file was deleted,
 * one notch less sharp because scope text is read by the drafting lawyer
 * before it goes out and carries no price.
 */

import { DEFAULT_SCOPE_TEMPLATES } from '@/lib/scope-library/default';
import type { ScopeTemplateSeed } from './types';

export const SEED_SCOPE_TEMPLATES: ScopeTemplateSeed[] = DEFAULT_SCOPE_TEMPLATES.map(
  (content, index) => ({
    slug: content.slug,
    name: content.name,
    is_active: true,
    sort_order: index,
    content,
  }),
);
