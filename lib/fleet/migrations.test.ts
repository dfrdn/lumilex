import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveMigrations, planInstance, migrationName } from './migrations';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');
const VERSIONS_FILE = path.resolve(__dirname, '../../supabase/migration-versions.json');

describe('the repository', () => {
  it('gives every migration file exactly one version, and nothing else', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const versions = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
    const { migrations, problems } = resolveMigrations(files, versions);
    expect(problems).toEqual([]);
    expect(migrations.length).toBe(files.filter((f) => f.endsWith('.sql')).length);
  });

  it('orders by applied version, not by filename', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const versions = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
    const order = resolveMigrations(files, versions).migrations.map((m) => m.name);
    expect(order[0]).toBe('baseline');
    // firm_allocators sorts first by filename but depends on both of these.
    expect(order.indexOf('firms_foundation')).toBeLessThan(order.indexOf('firm_allocators'));
    expect(order.indexOf('firm_id_wave')).toBeLessThan(order.indexOf('firm_allocators'));
  });
});

describe('resolveMigrations', () => {
  it('reports a file with no version', () => {
    const r = resolveMigrations(['20260101_a.sql'], {});
    expect(r.problems).toEqual(['20260101_a.sql has no entry in migration-versions.json']);
    expect(r.migrations).toEqual([]);
  });

  it('reports a version naming a missing file', () => {
    const r = resolveMigrations([], { '20260101_gone.sql': '20260101000000' });
    expect(r.problems[0]).toMatch(/does not exist/);
  });

  it('reports two files sharing a version', () => {
    const r = resolveMigrations(['a_x.sql', 'b_y.sql'], {
      'a_x.sql': '20260101000000',
      'b_y.sql': '20260101000000',
    });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/share version/);
  });

  it('rejects a short version', () => {
    const r = resolveMigrations(['20260101_a.sql'], { '20260101_a.sql': '20260101' });
    expect(r.problems[0]).toMatch(/14 digits/);
  });

  it('ignores non-sql files', () => {
    const r = resolveMigrations(['README.md'], {});
    expect(r.problems).toEqual([]);
  });
});

describe('planInstance', () => {
  const migrations = [
    { file: '0_base.sql', version: '00000000000001', name: 'base' },
    { file: '1_a.sql', version: '20260101000000', name: 'a' },
    { file: '1_b.sql', version: '20260102000000', name: 'b' },
    { file: '1_c.sql', version: '20260103000000', name: 'c' },
  ];

  it('treats an empty ledger as needing everything, with nothing out of order', () => {
    const p = planInstance(migrations, []);
    expect(p.pending.map((m) => m.name)).toEqual(['base', 'a', 'b', 'c']);
    expect(p.outOfOrder).toEqual([]);
  });

  it('is empty for an instance that is current', () => {
    const p = planInstance(
      migrations,
      migrations.map((m) => ({ version: m.version, name: m.name })),
    );
    expect(p.pending).toEqual([]);
  });

  it('flags a gap behind the newest applied migration', () => {
    const p = planInstance(migrations, [
      { version: '00000000000001', name: 'base' },
      { version: '20260101000000', name: 'a' },
      { version: '20260103000000', name: 'c' },
    ]);
    expect(p.pending.map((m) => m.name)).toEqual(['b']);
    expect(p.outOfOrder.map((m) => m.name)).toEqual(['b']);
  });

  it('reports ledger rows no file maps to, without treating them as pending', () => {
    const p = planInstance(migrations.slice(0, 1), [
      { version: '00000000000001', name: 'base' },
      { version: '20260101120000', name: 'folded_into_a_later_file' },
    ]);
    expect(p.pending).toEqual([]);
    expect(p.unknownApplied).toEqual([{ version: '20260101120000', name: 'folded_into_a_later_file' }]);
  });

  it('reports a version whose ledger name disagrees with the file', () => {
    const p = planInstance(migrations.slice(0, 2), [
      { version: '00000000000001', name: 'base' },
      { version: '20260101000000', name: 'something_else' },
    ]);
    expect(p.nameMismatches).toEqual([{ version: '20260101000000', file: '1_a.sql', ledgerName: 'something_else' }]);
  });
});

describe('migrationName', () => {
  it('strips the numeric prefix and extension', () => {
    expect(migrationName('20260823_firm_integrations.sql')).toBe('firm_integrations');
    expect(migrationName('00000000000001_baseline.sql')).toBe('baseline');
  });
});
