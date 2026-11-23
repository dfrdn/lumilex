import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  FORBIDDEN_PROJECT_REF_HASHES,
  applyOrder,
  dbUrlEnvVar,
  fleetSchema,
  isForbiddenProjectRef,
  urlMatchesRef,
} from './manifest';

const REF_A = 'abcdefghijklmnopqrst';
const REF_B = 'bcdefghijklmnopqrstu';

function instance(over: Record<string, unknown>) {
  return {
    slug: 'acme',
    role: 'firm',
    supabaseProjectRef: REF_A,
    vercelProject: null,
    primaryDomain: null,
    ...over,
  };
}

describe('fleet/instances.json', () => {
  it('parses', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../fleet/instances.json'), 'utf8'),
    );
    const parsed = fleetSchema.safeParse(raw);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('fleetSchema', () => {
  it('requires exactly one test instance', () => {
    expect(fleetSchema.safeParse({ instances: [instance({})] }).success).toBe(false);
    expect(
      fleetSchema.safeParse({
        instances: [instance({ role: 'test' }), instance({ slug: 't2', role: 'test', supabaseProjectRef: REF_B })],
      }).success,
    ).toBe(false);
  });

  it('refuses one project listed under two slugs', () => {
    const r = fleetSchema.safeParse({
      instances: [instance({ slug: 'test', role: 'test' }), instance({ slug: 'acme' })],
    });
    expect(r.success).toBe(false);
  });

  it("refuses a forbidden project, matched by the hash of its ref", () => {
    const forbidden = 'zzzzzzzzzzzzzzzzzzzz';
    const hash = createHash('sha256').update(forbidden).digest('hex');
    FORBIDDEN_PROJECT_REF_HASHES.add(hash);
    try {
      expect(isForbiddenProjectRef(forbidden)).toBe(true);
      const r = fleetSchema.safeParse({
        instances: [
          instance({ slug: 'test', role: 'test' }),
          instance({ slug: 'acme', supabaseProjectRef: forbidden }),
        ],
      });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toMatch(/origin app's production project/);
    } finally {
      FORBIDDEN_PROJECT_REF_HASHES.delete(hash);
    }
  });

  it('keeps the origin production guard armed', () => {
    expect(FORBIDDEN_PROJECT_REF_HASHES.size).toBeGreaterThan(0);
    for (const h of FORBIDDEN_PROJECT_REF_HASHES) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a test instance and a firm', () => {
    const r = fleetSchema.safeParse({
      instances: [instance({ slug: 'test', role: 'test', supabaseProjectRef: REF_B }), instance({})],
    });
    expect(r.success).toBe(true);
  });
});

describe('dbUrlEnvVar', () => {
  it('upper-snakes the slug', () => {
    expect(dbUrlEnvVar('acme-law')).toBe('FLEET_DB_URL_ACME_LAW');
  });
});

describe('urlMatchesRef', () => {
  it('matches a direct connection by host', () => {
    expect(urlMatchesRef(`postgresql://postgres:pw@db.${REF_A}.supabase.co:5432/postgres`, REF_A)).toBe(true);
  });

  it('matches a pooler connection by user', () => {
    expect(
      urlMatchesRef(`postgresql://postgres.${REF_A}:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`, REF_A),
    ).toBe(true);
  });

  it("refuses another project's URL", () => {
    expect(urlMatchesRef(`postgresql://postgres:pw@db.${REF_B}.supabase.co:5432/postgres`, REF_A)).toBe(false);
    expect(
      urlMatchesRef(`postgresql://postgres.${REF_B}:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`, REF_A),
    ).toBe(false);
  });

  it('refuses a ref that only appears in the password or path', () => {
    expect(urlMatchesRef(`postgresql://postgres:${REF_A}@db.${REF_B}.supabase.co:5432/${REF_A}`, REF_A)).toBe(false);
  });

  it('refuses garbage and non-postgres schemes', () => {
    expect(urlMatchesRef('not a url', REF_A)).toBe(false);
    expect(urlMatchesRef(`https://db.${REF_A}.supabase.co`, REF_A)).toBe(false);
  });
});

describe('applyOrder', () => {
  it('puts the test instance first whatever the manifest order', () => {
    const fleet = fleetSchema.parse({
      instances: [instance({}), instance({ slug: 'test', role: 'test', supabaseProjectRef: REF_B })],
    });
    expect(applyOrder(fleet).map((i) => i.slug)).toEqual(['test', 'acme']);
  });
});
