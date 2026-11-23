import { Client } from 'pg';
import { isForbiddenProjectRef } from '../lib/fleet/manifest';
import { applyOne, ensureLedger, loadMigrations, readLedger } from './migration-ledger';

/**
 * Build a Lumilex database from nothing: replay the baseline and every
 * migration, in the order of supabase/migration-versions.json, onto an empty
 * Supabase database; give its Vault the two secrets its triggers need; and
 * remove the development firm the replay seeds.
 *
 *   npx tsx scripts/bootstrap-database.ts --cron-secret <secret>
 *       the local stack (`supabase start`), reaching the app at
 *       http://host.docker.internal:3000
 *   npx tsx scripts/bootstrap-database.ts --db-url <url> --app-url <url> --cron-secret <secret>
 *       any other empty Supabase database
 *
 * It refuses a database whose ledger already holds a migration: that one is
 * brought current with `npm run fleet:migrate`, never rebuilt. The ledger it
 * writes is the one fleet:migrate reads, so later migrations reach it the
 * usual way.
 *
 * Proven 2026-11-01 against the local stack: the replay reproduces the test
 * instance's schema — columns, constraints, indexes, policies, grants, RLS
 * flags, functions, triggers and views — apart from what Supabase's platform
 * version adds and the demo's hand-installed objects.
 *
 * The Vault secrets are not optional. `call_app_api` / `call_app_api_post`
 * read `app_base_url` and `cron_secret` from it, and three triggers call them;
 * without either, those triggers roll back the statement that fired them and
 * every file analysis waits forever. `app_base_url` is where the *database*
 * reaches the app, which for the local stack is the host as seen from inside
 * Docker, not localhost.
 *
 * The development firm (`dev`) is seeded by the early migrations, which predate
 * provisioning: it owns `localhost` and `127.0.0.1` in firm_domains and carries
 * integration rows. On any instance a real firm will use, that is a second,
 * empty tenant holding the local hostnames, so it is removed unless
 * --keep-dev-firm says otherwise.
 */

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_APP_URL = 'http://host.docker.internal:3000';
const DEV_FIRM_SLUG = 'dev';

interface Args {
  dbUrl: string;
  appUrl: string | null;
  cronSecret: string | null;
  keepDevFirm: boolean;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dbUrl: process.env.BOOTSTRAP_DB_URL ?? LOCAL_DB_URL,
    appUrl: process.env.BOOTSTRAP_APP_URL ?? null,
    cronSecret: process.env.CRON_SECRET ?? null,
    keepDevFirm: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db-url') args.dbUrl = argv[++i] ?? fail('--db-url needs a connection string');
    else if (a === '--app-url') args.appUrl = argv[++i] ?? fail('--app-url needs a URL');
    else if (a === '--cron-secret') args.cronSecret = argv[++i] ?? fail('--cron-secret needs a value');
    else if (a === '--keep-dev-firm') args.keepDevFirm = true;
    else fail(`unknown argument ${a}`);
  }
  if (!args.appUrl && args.dbUrl === LOCAL_DB_URL) args.appUrl = LOCAL_APP_URL;
  if (!args.appUrl) fail('--app-url is required: the URL this database uses to reach the app');
  if (!args.cronSecret) fail('--cron-secret (or CRON_SECRET) is required: the same value the app is given');
  return args;
}

/** The Supabase project a connection string names, if it names one. */
function projectRef(connectionString: string): string | null {
  const url = new URL(connectionString);
  return url.hostname.match(/^db\.([a-z]{20})\.supabase\.co$/)?.[1]
    ?? decodeURIComponent(url.username).match(/^postgres\.([a-z]{20})$/)?.[1]
    ?? null;
}

async function setVaultSecret(client: Client, name: string, value: string): Promise<void> {
  const { rows } = await client.query('select id from vault.secrets where name = $1', [name]);
  if (rows.length) await client.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
  else await client.query('select vault.create_secret($1, $2)', [value, name]);
}

/**
 * Delete every row the development firm owns, then the firm. Tables are
 * emptied in passes because foreign keys between them fix an order this
 * script would otherwise have to know: a delete a reference still blocks is
 * retried on the next pass, after whatever referenced it has gone.
 */
async function removeDevFirm(client: Client): Promise<number> {
  const { rows: firm } = await client.query('select id from public.firms where slug = $1', [DEV_FIRM_SLUG]);
  if (!firm.length) return 0;
  const firmId = firm[0].id as string;

  const { rows } = await client.query<{ table: string }>(
    `select c.relname as table
       from pg_class c
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'firm_id' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`,
  );
  let pending = rows.map((r) => r.table);
  let removed = 0;
  await client.query('begin');
  try {
    await client.query(`set local lumilex.skip_activity = 'on'`);
    while (pending.length) {
      const blocked: string[] = [];
      for (const table of pending) {
        await client.query('savepoint dev_firm');
        try {
          const res = await client.query(`delete from public.${quoteIdent(table)} where firm_id = $1`, [firmId]);
          removed += res.rowCount ?? 0;
          await client.query('release savepoint dev_firm');
        } catch (err) {
          await client.query('rollback to savepoint dev_firm');
          if ((err as { code?: string }).code !== '23503') throw err;
          blocked.push(table);
        }
      }
      if (blocked.length === pending.length) {
        throw new Error(`could not empty ${blocked.join(', ')}: rows elsewhere still reference them`);
      }
      pending = blocked;
    }
    await client.query('delete from public.firms where id = $1', [firmId]);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  }
  return removed;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ref = projectRef(args.dbUrl);
  if (ref && isForbiddenProjectRef(ref)) fail(`${ref} is the origin app's production project and must never receive Lumilex migrations`);

  const { migrations, problems } = loadMigrations();
  if (problems.length) fail(`the migrations directory and its version map disagree:\n  ${problems.join('\n  ')}`);

  const client = new Client({ connectionString: args.dbUrl });
  await client.connect();
  try {
    const ledger = await readLedger(client);
    if (ledger && ledger.length > 0) {
      fail(`this database already has ${ledger.length} migration(s) applied — bring it current with npm run fleet:migrate`);
    }
    await ensureLedger(client);

    console.log(`Replaying ${migrations.length} migrations onto an empty database\n`);
    for (const m of migrations) {
      process.stdout.write(`  ${m.version}  ${m.file} … `);
      try {
        await applyOne(client, m);
        console.log('ok');
      } catch (err) {
        console.log('FAILED');
        fail(`${m.file}: ${(err as Error).message}`);
      }
    }

    await setVaultSecret(client, 'app_base_url', args.appUrl!.replace(/\/+$/, ''));
    await setVaultSecret(client, 'cron_secret', args.cronSecret!);
    console.log(`\nVault: app_base_url = ${args.appUrl}, cron_secret set`);

    if (args.keepDevFirm) {
      console.log('Development firm kept (--keep-dev-firm)');
    } else {
      const rows = await removeDevFirm(client);
      console.log(`Development firm removed (${rows} row${rows === 1 ? '' : 's'} with it)`);
    }
    console.log('\nDone. Provision a firm next: npx tsx scripts/provision-firm.ts <config.json>');
  } finally {
    await client.end();
  }
}

main().catch((err) => fail((err as Error).stack ?? String(err)));
