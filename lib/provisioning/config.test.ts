import { describe, it, expect } from 'vitest';
import {
  parseProvisionConfig,
  assertMatchesPattern,
  derivedDocumentRoot,
  entitlementMap,
  ProvisionConfigError,
  type ProvisionConfig,
} from './config';

// The two patterns provisioning_patterns() returns from the live constraints.
// Pinned here so a change to firms_slug_check shows up as a failing test rather
// than as a provisioning run that rejects a slug the database would have taken.
const SLUG_PATTERN = '^[a-z0-9][a-z0-9-]{1,30}$';
const PREFIX_PATTERN = '^[A-Z0-9]{2,8}$';

const MINIMAL = {
  slug: 'acme-legal',
  name: 'Acme Legal Services',
  shortName: 'ACME',
  primaryDomain: 'app.acmelegal.ph',
  invoicePrefix: 'ACME',
  admin: { email: 'admin@acmelegal.ph', name: 'A. Reyes' },
  branding: {
    documentName: 'Acme Legal Services',
    palette: { primary: '#0F2A44', accent: '#B08D57' },
  },
};

describe('parseProvisionConfig', () => {
  it('accepts a minimal config and defaults the rest to off/blank', () => {
    const config = parseProvisionConfig(MINIMAL);
    expect(config.features).toEqual([]);
    expect(config.branding.fontSet).toBe('standard');
    expect(config.branding.nameLines).toEqual([]);
    expect(config.email.ownedDomains).toEqual([]);
    expect(config.documents.financeRoot).toBe('');
    expect(config.admin.position).toBe('');
  });

  it('normalises the values the database is picky about', () => {
    const config = parseProvisionConfig({
      ...MINIMAL,
      slug: '  ACME-Legal ',
      invoicePrefix: 'acme',
      primaryDomain: 'App.AcmeLegal.PH',
      admin: { ...MINIMAL.admin, email: '  Admin@AcmeLegal.PH ' },
    });
    // firm_domains has a CHECK that domain = lower(domain).
    expect(config.primaryDomain).toBe('app.acmelegal.ph');
    expect(config.slug).toBe('acme-legal');
    expect(config.invoicePrefix).toBe('ACME');
    expect(config.admin.email).toBe('admin@acmelegal.ph');
  });

  it('rejects a domain given as a URL or an email', () => {
    expect(() =>
      parseProvisionConfig({ ...MINIMAL, primaryDomain: 'https://acmelegal.ph/app' }),
    ).toThrow(ProvisionConfigError);
    expect(() => parseProvisionConfig({ ...MINIMAL, primaryDomain: 'admin@acmelegal.ph' })).toThrow(
      ProvisionConfigError,
    );
  });

  // lib/pdf/brand.ts throws at render time on an unset palette or document
  // name. Refusing the config is the cheaper place to find out.
  it('requires the branding a document render will demand', () => {
    expect(() => parseProvisionConfig({ ...MINIMAL, branding: {} })).toThrow(ProvisionConfigError);
    expect(() =>
      parseProvisionConfig({
        ...MINIMAL,
        branding: { ...MINIMAL.branding, palette: { primary: 'navy', accent: '#B08D57' } },
      }),
    ).toThrow(/hex/);
  });

  it('rejects a feature key that is not in the registry', () => {
    expect(() => parseProvisionConfig({ ...MINIMAL, features: ['sharepoint'] })).not.toThrow();
    expect(() => parseProvisionConfig({ ...MINIMAL, features: ['sharepont'] })).toThrow(
      ProvisionConfigError,
    );
  });

  it('names every bad field at once rather than one per run', () => {
    try {
      parseProvisionConfig({ ...MINIMAL, name: '', shortName: '', admin: { email: 'nope', name: '' } });
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('name');
      expect(message).toContain('shortName');
      expect(message).toContain('admin.email');
    }
  });
});

describe('assertMatchesPattern', () => {
  it('passes a value the constraint accepts', () => {
    expect(() => assertMatchesPattern('acme-legal', SLUG_PATTERN, 'Firm slug', '')).not.toThrow();
    expect(() => assertMatchesPattern('ACME', PREFIX_PATTERN, 'Invoice prefix', '')).not.toThrow();
  });

  it('rejects the shapes the constraint would have rejected as a 23514', () => {
    for (const bad of ['Acme Legal', 'a', '-acme', 'acme_legal', 'ACME']) {
      expect(() => assertMatchesPattern(bad, SLUG_PATTERN, 'Firm slug', '')).toThrow(
        ProvisionConfigError,
      );
    }
    for (const bad of ['A', 'acme', 'ACME-LEGAL', 'TOOLONGPREFIX']) {
      expect(() => assertMatchesPattern(bad, PREFIX_PATTERN, 'Invoice prefix', '')).toThrow(
        ProvisionConfigError,
      );
    }
  });

  it('puts the required shape and a hint in the message', () => {
    expect(() => assertMatchesPattern('Acme Legal', SLUG_PATTERN, 'Firm slug', 'use hyphens')).toThrow(
      /Firm slug "Acme Legal"[\s\S]*\^\[a-z0-9\][\s\S]*use hyphens/,
    );
  });
});

describe('derivedDocumentRoot', () => {
  const config = parseProvisionConfig(MINIMAL);

  it('derives from the short name when unset, matching documentRoot()', () => {
    expect(derivedDocumentRoot(config, 'finance')).toBe('ACME Finance');
    expect(derivedDocumentRoot(config, 'corporate')).toBe('ACME Corporate');
  });

  it('uses the configured root when given', () => {
    const configured = parseProvisionConfig({
      ...MINIMAL,
      documents: { financeRoot: '  Acme Billing  ', corporateRoot: '' },
    });
    expect(derivedDocumentRoot(configured, 'finance')).toBe('Acme Billing');
    expect(derivedDocumentRoot(configured, 'corporate')).toBe('ACME Corporate');
  });
});

describe('entitlementMap', () => {
  it('is empty by default — an unlisted feature is off', () => {
    expect(entitlementMap(parseProvisionConfig(MINIMAL))).toEqual({});
  });

  it('marks only what the firm bought', () => {
    const config: ProvisionConfig = parseProvisionConfig({
      ...MINIMAL,
      features: ['portal', 'sharepoint'],
    });
    expect(entitlementMap(config)).toEqual({ portal: true, sharepoint: true });
  });
});
