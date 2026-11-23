import * as fs from 'fs';
import * as path from 'path';
import type { Client } from 'pg';
import { resolveMigrations, type Migration } from '../lib/fleet/migrations';

/**
 * The IO shared by the two scripts that apply migrations: fleet-migrate.ts,
 * which brings existing instances current, and bootstrap-database.ts, which
 * builds an empty one. Both read the same directory in the same order and
 * write the same ledger, so an instance either built is one fleet:migrate can
 * carry forward.
 */

const ROOT = path.resolve(__dirname, '..');
export const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
export const VERSIONS_FILE = path.join(ROOT, 'supabase', 'migration-versions.json');
export const LOCK_KEY = 'lumilex-fleet-migrate';

/** Every migration in apply order, or the reasons the directory and its map disagree. */
export function loadMigrations(): { migrations: Migration[]; problems: string[] } {
  return resolveMigrations(
    fs.readdirSync(MIGRATIONS_DIR),
    JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf-8')),
  );
}

export async function readLedger(client: Client): Promise<{ version: string; name: string | null }[] | null> {
  const { rows: exists } = await client.query(
    `select to_regclass('supabase_migrations.schema_migrations') is not null as present`,
  );
  if (!exists[0].present) return null;
  const { rows } = await client.query(
    'select version, name from supabase_migrations.schema_migrations order by version',
  );
  return rows;
}

export async function ensureLedger(client: Client): Promise<void> {
  await client.query(
    `create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (
       version text primary key, statements text[], name text
     )`,
  );
}

/** One migration and its ledger row, committed together or not at all. */
export async function applyOne(client: Client, m: Migration): Promise<void> {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, m.file), 'utf-8');
  await client.query('begin');
  try {
    await client.query(`set local statement_timeout = '15min'`);
    await client.query(sql);
    await client.query(
      'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
      [m.version, m.name, [sql]],
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  }
}
