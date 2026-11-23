import { describe, it, expect } from 'vitest';
import { SEED_PACK, resolutionTemplateId } from './index';
import { seededMatterTypeCodes } from './enum-options';
import { firmProfileIdentityValues } from './firm-profile';
import { PLACEHOLDER_HOURLY_RATE } from './billing-rates';
import { feeScheduleContentSchema } from '@/lib/fee-schedule/schema';
import { scopeTemplateContentSchema } from '@/lib/scope-library/schema';
import { firmProfileContentSchema } from '@/lib/firm-profile/schema';
import { pricedTiers } from '@/lib/fee-schedule/types';
import { MATTER_TYPE_CODES } from '@/lib/admin/entity-config';
import { SENIORITY_ORDER } from '@/lib/billing/seniority';

/**
 * The seed pack is data, so this is where its contract lives: every row must
 * validate against the schema the app saves through, and nothing in it may
 * carry an identity or a price.
 */

// Mirrors the CHECK constraints on the tables the pack writes to. A value the
// database would reject should fail here, not halfway through provisioning.
const EMAIL_CATEGORIES = new Set([
  'general', 'court_filing', 'client_update', 'demand_letter', 'follow_up',
  'engagement', 'billing', 'reminder', 'overdue', 'final',
]);
const RESOLUTION_KINDS = new Set([
  'Board Resolution', 'Stockholders Resolution', 'Secretarys Certificate',
]);
const RESOLUTION_CATEGORIES = new Set([
  'Banking', 'Real Estate', 'Corporate Governance', 'Capital & Shares', 'HR',
  'Tax', 'Litigation', 'Government', 'Loans & Credit',
]);
const DOCUMENT_CATEGORIES = new Set(['legal', 'letter', 'form', 'report', 'corporate']);

describe('seed pack — enum options', () => {
  it('seeds every group the app has a dropdown for', () => {
    const groups = new Set(SEED_PACK.enumOptions.map((o) => `${o.entity}.${o.field}`));
    expect(groups.has('matters.type')).toBe(true);
    expect(groups.has('deliverables.subtype')).toBe(true);
    expect(groups.has('files.origin')).toBe(true);
    expect(groups.size).toBeGreaterThanOrEqual(12);
  });

  // deriveMatterCode() reads metadata.code through fetchMatterTypeCodes(firmId).
  // A firm seeded without it derives every matter code with type 0.
  it('carries the matter-type → code map deriveMatterCode depends on', () => {
    expect(seededMatterTypeCodes()).toEqual(MATTER_TYPE_CODES);
  });

  it('puts metadata only on matters.type', () => {
    for (const row of SEED_PACK.enumOptions) {
      const isMatterType = row.entity === 'matters' && row.field === 'type';
      expect(row.metadata === null).toBe(!isMatterType);
    }
  });

  it("is unique on (entity, field, value) — the table's unique index", () => {
    const keys = SEED_PACK.enumOptions.map((o) => `${o.entity}.${o.field}.${o.value}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('orders each group from zero without gaps', () => {
    const byGroup = new Map<string, number[]>();
    for (const row of SEED_PACK.enumOptions) {
      const key = `${row.entity}.${row.field}`;
      byGroup.set(key, [...(byGroup.get(key) ?? []), row.sort_order]);
    }
    for (const orders of byGroup.values()) {
      expect([...orders].sort((a, b) => a - b)).toEqual(orders.map((_, i) => i));
    }
  });
});

describe('seed pack — billing rates', () => {
  it('seeds one row per position the app sorts by', () => {
    expect(SEED_PACK.billingRates.map((r) => r.position)).toEqual([...SENIORITY_ORDER]);
  });

  // A seeded "sensible" rate would bill a client at another firm's price and
  // look entirely normal on the invoice.
  it('prices nothing', () => {
    expect(PLACEHOLDER_HOURLY_RATE).toBe(0);
    for (const rate of SEED_PACK.billingRates) {
      expect(rate.hourly_rate).toBe(0);
      expect(rate.currency).toBe('PHP');
    }
  });
});

describe('seed pack — fee schedules', () => {
  it('validates against the schema the CMS saves through', () => {
    for (const schedule of SEED_PACK.feeSchedules) {
      expect(() => feeScheduleContentSchema.parse(schedule.content)).not.toThrow();
      expect(schedule.content.slug).toBe(schedule.slug);
    }
  });

  it('covers the four slugs the app reasons about', () => {
    expect(SEED_PACK.feeSchedules.map((s) => s.slug)).toEqual([
      'professional', 'trademark', 'patent', 'copyright',
    ]);
  });

  // The whole reason these rows exist. lib/fee-schedule/default.ts — one real
  // firm's 2026 rate card, served to any firm that had saved none — is deleted,
  // and loadFeeSchedules() now throws instead. These rows are what a provisioned
  // firm edits from, so they must carry structure and no figure.
  it('quotes no figure — no tier is priced, no rate or acceptance fee is listed', () => {
    const professional = SEED_PACK.feeSchedules.find((s) => s.slug === 'professional')!;
    const body = professional.content.body;
    expect(body.kind).toBe('professional');
    if (body.kind !== 'professional') return;

    expect(pricedTiers(body)).toEqual([]);
    expect(body.hourly.rates).toEqual([]);
    expect(body.acceptance.fees).toEqual([]);
    expect(body.retainer.initialFeeMonths).toBe(0);
    for (const tier of body.retainer.tiers) {
      expect(tier.monthlyFee).toBeNull();
      expect(tier.hours).toBeNull();
      expect(tier.discountPct).toBeNull();
    }
  });

  it('ships the IP schedules as headers with no priced rows', () => {
    for (const schedule of SEED_PACK.feeSchedules.filter((s) => s.slug !== 'professional')) {
      const body = schedule.content.body;
      expect(body.kind).toBe('table');
      if (body.kind !== 'table') continue;
      expect(body.groups).toEqual([]);
      expect(body.columns.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('leaves the cover — which is letterhead — blank', () => {
    for (const { content } of SEED_PACK.feeSchedules) {
      expect(content.cover.firmName).toBe('');
      expect(content.cover.addressLines).toEqual([]);
      expect(content.cover.email).toBe('');
      expect(content.cover.website).toBe('');
      expect(content.cover.phone).toBe('');
    }
  });
});

describe('seed pack — scope templates', () => {
  it('validates against the schema the CMS saves through', () => {
    for (const template of SEED_PACK.scopeTemplates) {
      expect(() => scopeTemplateContentSchema.parse(template.content)).not.toThrow();
      expect(template.content.slug).toBe(template.slug);
    }
  });

  it("has a unique slug per line — the table's (firm_id, slug) unique", () => {
    const slugs = SEED_PACK.scopeTemplates.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('names only fee schedules the pack also seeds', () => {
    const seeded = new Set(SEED_PACK.feeSchedules.map((s) => s.slug));
    for (const template of SEED_PACK.scopeTemplates) {
      for (const slug of template.content.feeScheduleSlugs) {
        expect(seeded.has(slug)).toBe(true);
      }
    }
  });

  it('ends the library with the exclusion clauses', () => {
    expect(SEED_PACK.scopeTemplates.some((t) => t.content.role === 'exclusions')).toBe(true);
  });
});

describe('seed pack — document templates', () => {
  it('uses only categories the picker offers, and only AI mode', () => {
    for (const template of SEED_PACK.documentTemplates) {
      expect(DOCUMENT_CATEGORIES.has(template.category)).toBe(true);
      // A 'placeholder' template needs a DOCX in the templates bucket, which a
      // data module cannot ship.
      expect(template.generation_mode).toBe('ai');
      expect(template.ai_prompt.length).toBeGreaterThan(40);
      expect(template.deadline_kind).toBeNull();
    }
  });

  it('has unique names — how seed-template-files.mjs and re-runs match rows', () => {
    const names = SEED_PACK.documentTemplates.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('declares placeholders in the shape the editor reads', () => {
    for (const template of SEED_PACK.documentTemplates) {
      for (const p of template.placeholders) {
        expect(p.key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(p.label.length).toBeGreaterThan(0);
        expect(['text', 'textarea', 'number', 'date']).toContain(p.type);
      }
    }
  });
});

describe('seed pack — email templates', () => {
  it('uses only CHECK-constrained categories', () => {
    for (const template of SEED_PACK.emailTemplates) {
      expect(EMAIL_CATEGORIES.has(template.category)).toBe(true);
    }
  });

  // The app enforces one default per category by unsetting the others on save,
  // not with a partial unique index — so the seed has to arrive consistent.
  it('marks at most one default per category', () => {
    const defaults = SEED_PACK.emailTemplates.filter((t) => t.is_category_default);
    expect(new Set(defaults.map((t) => t.category)).size).toBe(defaults.length);
  });

  it('covers the four billing-cycle categories the batch send reaches for', () => {
    const defaults = new Set(
      SEED_PACK.emailTemplates.filter((t) => t.is_category_default).map((t) => t.category),
    );
    for (const category of ['billing', 'reminder', 'overdue', 'final']) {
      expect(defaults.has(category as never)).toBe(true);
    }
  });

  it('declares every token its body actually uses', () => {
    for (const template of SEED_PACK.emailTemplates) {
      const used = new Set(
        [...`${template.subject} ${template.body_html}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]),
      );
      expect([...used].sort()).toEqual([...template.variables].sort());
    }
  });
});

describe('seed pack — resolution templates', () => {
  it('uses only CHECK-constrained kinds and categories', () => {
    for (const template of SEED_PACK.resolutionTemplates) {
      expect(RESOLUTION_KINDS.has(template.kind)).toBe(true);
      expect(RESOLUTION_CATEGORIES.has(template.category)).toBe(true);
    }
  });

  it('has a unique firm-local key', () => {
    const keys = SEED_PACK.resolutionTemplates.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(30);
  });

  // resolution_templates.id is a GLOBAL text primary key: two firms seeding the
  // bare keys would collide, and the second upsert would rewrite the first
  // firm's catalogue.
  it('namespaces ids per firm', () => {
    expect(resolutionTemplateId('alpha', 'open-bank-account')).toBe('alpha:open-bank-account');
    expect(resolutionTemplateId('alpha', 'x')).not.toBe(resolutionTemplateId('beta', 'x'));
  });

  it('declares a variable for every token in the body', () => {
    for (const template of SEED_PACK.resolutionTemplates) {
      const used = [...template.body_template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      const declared = new Set(template.variable_schema.map((v) => v.key));
      for (const key of used) {
        expect(declared.has(key), `${template.key} uses {{${key}}} undeclared`).toBe(true);
      }
    }
  });
});

describe('seed pack — firm profile', () => {
  it('validates against the schema the CMS saves through', () => {
    expect(() => firmProfileContentSchema.parse(SEED_PACK.firmProfile)).not.toThrow();
  });

  it('carries no identity at all', () => {
    for (const value of firmProfileIdentityValues(SEED_PACK.firmProfile)) {
      expect(value).toBe('');
    }
  });

  it('keeps the section headings, which are page furniture', () => {
    expect(SEED_PACK.firmProfile.about.heading).toBe('About Us');
    expect(SEED_PACK.firmProfile.contact.heading).toBe('Contact Us');
  });
});

describe('seed pack — the whole pack', () => {
  // Rows are stamped by getServiceDbForFirm at insert. A seed row that carried
  // its own firm_id would either be rejected by the scoped client or file one
  // firm's content under another.
  it('carries no firm_id anywhere', () => {
    expect(JSON.stringify(SEED_PACK)).not.toContain('firm_id');
  });

  it('has content in every group it claims to seed', () => {
    expect(SEED_PACK.enumOptions.length).toBeGreaterThan(0);
    expect(SEED_PACK.billingRates.length).toBeGreaterThan(0);
    expect(SEED_PACK.feeSchedules.length).toBe(4);
    expect(SEED_PACK.scopeTemplates.length).toBeGreaterThan(0);
    expect(SEED_PACK.documentTemplates.length).toBeGreaterThan(0);
    expect(SEED_PACK.emailTemplates.length).toBeGreaterThan(0);
    expect(SEED_PACK.resolutionTemplates.length).toBeGreaterThan(0);
  });
});
