import { Client } from 'pg';
import { isForbiddenProjectRef } from '../lib/fleet/manifest';
import { planInstance } from '../lib/fleet/migrations';
import { LOCK_KEY, applyOne, loadMigrations, readLedger } from './migration-ledger';

/**
 * Bring one Lumilex database up to the migrations in this checkout.
 *
 *   npx tsx scripts/migrate-database.ts --db-url <url>            # what is pending
 *   npx tsx scripts/migrate-database.ts --db-url <url> --apply    # apply it
 *
 * For a self-hosted instance: one database, built by bootstrap-database.ts.
 * The operator of several instances uses `npm run fleet:migrate`, which adds
 * the fleet's rules (the test instance first, then every firm) on top of the
 * same per-database checks this applies:
 *
 *   - order comes from supabase/migration-versions.json, not filenames;
 *   - an empty ledger is refused — build that database with db:bootstrap;
 *   - a pending migration older than one already applied is refused, as is a
 *     ledger row whose name disagrees with the file at its version;
 *   - each migration commits with its ledger row or not at all, and the run
 *     stops at the first failure.
 *
 * Take a backup first. Supabase's daily backups or `pg_dump` will do; the
 * command does not take one for you.
 */

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { dbUrl: string; apply: boolean } {
  let dbUrl = process.env.MIGRATE_DB_URL ?? '';
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db-url') dbUrl = argv[++i] ?? fail('--db-url needs a connection string');
    else if (a === '--apply') apply = true;
    else fail(`unknown argument ${a}`);
  }
  if (!dbUrl) fail('--db-url (or MIGRATE_DB_URL) is required');
  return { dbUrl, apply };
}

async function main(): Promise<void> {
  const { dbUrl, apply } = parseArgs(process.argv.slice(2));
  const host = new URL(dbUrl);
  const ref = host.hostname.match(/^db\.([a-z]{20})\.supabase\.co$/)?.[1]
    ?? decodeURIComponent(host.username).match(/^postgres\.([a-z]{20})$/)?.[1];
  if (ref && isForbiddenProjectRef(ref)) fail(`${ref} is the origin app's production project and must never receive Lumilex migrations`);

  const { migrations, problems } = loadMigrations();
  if (problems.length) fail(`the migrations directory and its version map disagree:\n  ${problems.join('\n  ')}`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const ledger = await readLedger(client);
    if (!ledger || ledger.length === 0) fail('this database has no migrations applied — build it with npm run db:bootstrap');
    const plan = planInstance(migrations, ledger);

    for (const m of plan.outOfOrder) console.log(`  ORDER  ${m.version}  ${m.file} is older than a migration already applied`);
    for (const n of plan.nameMismatches) console.log(`  NAME   ${n.version}  ledger says "${n.ledgerName}", map says ${n.file}`);
    for (const r of plan.unknownApplied) console.log(`  ledger ${r.version}  ${r.name ?? '(unnamed)'} — no file maps to it`);
    if (plan.outOfOrder.length) fail('refusing: a pending migration is older than one already applied');
    if (plan.nameMismatches.length) fail('refusing: the ledger and the version map disagree on a name');

    if (!plan.pending.length) {
      console.log('Up to date.');
      return;
    }
    for (const m of plan.pending) console.log(`  pending  ${m.version}  ${m.file}`);
    if (!apply) {
      console.log(`\n${plan.pending.length} to apply. Re-run with --apply, after a backup.`);
      return;
    }

    const { rows: lock } = await client.query('select pg_try_advisory_lock(hashtext($1)) as got', [LOCK_KEY]);
    if (!lock[0].got) fail('another migration run holds this database');

    console.log('');
    for (const m of plan.pending) {
      process.stdout.write(`  applying  ${m.version}  ${m.file} … `);
      try {
        await applyOne(client, m);
        console.log('ok');
      } catch (err) {
        console.log('FAILED');
        fail(`${m.file}: ${(err as Error).message}`);
      }
    }
    console.log(`\n${plan.pending.length} applied.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => fail((err as Error).stack ?? String(err)));
