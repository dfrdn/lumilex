import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { fleetSchema, applyOrder, dbUrlEnvVar, urlMatchesRef, type FleetInstance } from '../lib/fleet/manifest';
import { planInstance, type Migration, type InstancePlan } from '../lib/fleet/migrations';
import { LOCK_KEY, applyOne, ensureLedger, loadMigrations, readLedger } from './migration-ledger';

/**
 * Bring every Lumilex instance's database up to the migrations in this repo.
 *
 *   npx tsx scripts/fleet-migrate.ts                  # status: what each instance is missing
 *   npx tsx scripts/fleet-migrate.ts --apply          # test project first, then every firm
 *   npx tsx scripts/fleet-migrate.ts --apply --only acme
 *
 * Instances come from fleet/instances.json. Order comes from
 * supabase/migration-versions.json (see lib/fleet/migrations.ts for why not
 * filenames). Each instance's applied set is its own ledger,
 * supabase_migrations.schema_migrations — the table the Supabase MCP's
 * apply_migration writes too, so the two agree on what has run.
 *
 * Rules, each enforced rather than advised:
 *   - A migration reaches the test project before any firm. Applying to a firm
 *     is refused while the test project has anything pending.
 *   - The run stops at the first failure. Each migration and its ledger row
 *     commit together or not at all, so a failed instance is left exactly one
 *     migration short, never half-way through one.
 *   - A pending migration older than one already applied is refused: the
 *     instance skipped something, and running it now runs it against a schema
 *     it was never written for.
 *   - A connection string must name its own project (host or pooler user), so
 *     a URL pasted under the wrong variable cannot migrate the wrong firm.
 *   - A firm instance with an empty ledger is a fresh bootstrap and needs
 *     --bootstrap. Replaying the whole directory onto a new project is not yet
 *     proven, and it seeds the development firm — see
 *     docs/multitenancy-followups.md → "One codebase, one instance per firm".
 *
 * Connection strings are secrets and never live in the manifest. Each is read
 * from FLEET_DB_URL_<SLUG> (e.g. FLEET_DB_URL_ACME_LAW), from the environment
 * or from a gitignored .env.fleet beside .env.local. TLS verifies against
 * Supabase's CA — download it from the project's Database settings and point
 * FLEET_DB_CA_CERT at the file. --insecure-tls skips verification and says so.
 */

const ROOT = path.resolve(__dirname, '..');
const FLEET_FILE = path.join(ROOT, 'fleet', 'instances.json');

interface Args {
  apply: boolean;
  only: string | null;
  bootstrap: boolean;
  insecureTls: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, only: null, bootstrap: false, insecureTls: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--bootstrap') args.bootstrap = true;
    else if (a === '--insecure-tls') args.insecureTls = true;
    else if (a === '--only') args.only = argv[++i] ?? fail('--only needs a slug');
    else fail(`unknown argument ${a}`);
  }
  return args;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function tlsConfig(insecure: boolean): { ca?: string; rejectUnauthorized: boolean } {
  const caPath = process.env.FLEET_DB_CA_CERT;
  if (caPath) return { ca: fs.readFileSync(caPath, 'utf-8'), rejectUnauthorized: true };
  if (insecure) {
    console.warn('! --insecure-tls: the connection is encrypted but the server certificate is not verified.');
    return { rejectUnauthorized: false };
  }
  return fail(
    'FLEET_DB_CA_CERT is not set. Download the CA certificate from the Supabase project ' +
      '(Database settings → SSL configuration) and point FLEET_DB_CA_CERT at it, or pass --insecure-tls.',
  );
}

/** sslmode in the URL would override the ssl object pg is given, so strip it. */
function withoutSslParams(connectionString: string): string {
  const url = new URL(connectionString);
  for (const p of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(p);
  return url.toString();
}

interface Outcome {
  slug: string;
  state: 'current' | 'pending' | 'applied' | 'failed' | 'skipped' | 'refused';
  detail: string;
}

function describePlan(plan: InstancePlan): string[] {
  const lines: string[] = [];
  for (const m of plan.pending) lines.push(`    pending   ${m.version}  ${m.file}`);
  for (const m of plan.outOfOrder) lines.push(`    ORDER     ${m.version}  ${m.file} is older than a migration already applied`);
  for (const r of plan.unknownApplied) lines.push(`    ledger    ${r.version}  ${r.name ?? '(unnamed)'} — no file maps to it`);
  for (const n of plan.nameMismatches) {
    lines.push(`    NAME      ${n.version}  ledger says "${n.ledgerName}", map says ${n.file}`);
  }
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(path.join(ROOT, '.env.fleet'));

  const fleetParse = fleetSchema.safeParse(JSON.parse(fs.readFileSync(FLEET_FILE, 'utf-8')));
  if (!fleetParse.success) {
    fail(`fleet/instances.json is invalid:\n  ${fleetParse.error.issues.map((i) => i.message).join('\n  ')}`);
  }
  const fleet = fleetParse.data;

  const { migrations, problems } = loadMigrations();
  if (problems.length) fail(`the migrations directory and its version map disagree:\n  ${problems.join('\n  ')}`);

  const ordered = applyOrder(fleet);
  if (args.only && !ordered.some((i) => i.slug === args.only)) fail(`no instance "${args.only}" in fleet/instances.json`);
  let ssl: ReturnType<typeof tlsConfig> | null = null;
  const tls = () => (ssl ??= tlsConfig(args.insecureTls));

  console.log(`${migrations.length} migrations, ${ordered.length} instances — ${args.apply ? 'APPLY' : 'status only'}\n`);

  const outcomes: Outcome[] = [];
  let testCurrent = false;

  for (const inst of ordered) {
    const targeted = !args.only || inst.slug === args.only || inst.role === 'test';
    if (!targeted) continue;
    const outcome = await runInstance(inst, migrations, args, tls, testCurrent);
    outcomes.push(outcome);
    if (inst.role === 'test') testCurrent = outcome.state === 'current' || outcome.state === 'applied';
    if (args.apply && (outcome.state === 'failed' || outcome.state === 'refused')) break;
  }

  console.log('\n' + '─'.repeat(72));
  for (const o of outcomes) console.log(`  ${o.slug.padEnd(20)} ${o.state.padEnd(8)} ${o.detail}`);
  console.log('─'.repeat(72));

  const bad = outcomes.some((o) => o.state === 'failed' || o.state === 'refused');
  process.exit(bad ? 1 : 0);
}

async function runInstance(
  inst: FleetInstance,
  migrations: Migration[],
  args: Args,
  tls: () => { ca?: string; rejectUnauthorized: boolean },
  testCurrent: boolean,
): Promise<Outcome> {
  const label = `${inst.slug} (${inst.role}, ${inst.supabaseProjectRef})`;
  console.log(label);

  const envVar = dbUrlEnvVar(inst.slug);
  const url = process.env[envVar];
  if (!url) {
    console.log(`    no connection string — set ${envVar}\n`);
    return { slug: inst.slug, state: args.apply ? 'refused' : 'skipped', detail: `${envVar} is not set` };
  }
  if (!urlMatchesRef(url, inst.supabaseProjectRef)) {
    console.log(`    ${envVar} does not point at ${inst.supabaseProjectRef}\n`);
    return { slug: inst.slug, state: 'refused', detail: `${envVar} names a different project` };
  }

  const client = new Client({ connectionString: withoutSslParams(url), ssl: tls() });
  await client.connect();
  try {
    const ledger = await readLedger(client);
    const plan = planInstance(migrations, ledger ?? []);
    for (const line of describePlan(plan)) console.log(line);
    if (!plan.pending.length) console.log('    up to date');
    console.log('');

    if (plan.outOfOrder.length) {
      return { slug: inst.slug, state: 'refused', detail: `${plan.outOfOrder.length} out-of-order migration(s)` };
    }
    if (plan.nameMismatches.length) {
      return { slug: inst.slug, state: 'refused', detail: 'ledger and version map disagree on a name' };
    }
    if (!plan.pending.length) return { slug: inst.slug, state: 'current', detail: '' };
    if (!args.apply) return { slug: inst.slug, state: 'pending', detail: `${plan.pending.length} to apply` };

    if (inst.role === 'firm' && !testCurrent) {
      return { slug: inst.slug, state: 'refused', detail: 'the test project must be current first' };
    }
    const fresh = !ledger || ledger.length === 0;
    if (inst.role === 'firm' && fresh && !args.bootstrap) {
      return { slug: inst.slug, state: 'refused', detail: 'empty ledger — a fresh bootstrap needs --bootstrap' };
    }

    const { rows: lock } = await client.query('select pg_try_advisory_lock(hashtext($1)) as got', [LOCK_KEY]);
    if (!lock[0].got) {
      return { slug: inst.slug, state: 'refused', detail: 'another fleet-migrate run holds this instance' };
    }

    await ensureLedger(client);

    let done = 0;
    for (const m of plan.pending) {
      process.stdout.write(`    applying  ${m.version}  ${m.file} … `);
      try {
        await applyOne(client, m);
        done++;
        console.log('ok');
      } catch (err) {
        console.log('FAILED');
        console.log(`      ${(err as Error).message}`);
        return {
          slug: inst.slug,
          state: 'failed',
          detail: `${done} applied, stopped at ${m.file}`,
        };
      }
    }
    return { slug: inst.slug, state: 'applied', detail: `${done} applied` };
  } finally {
    await client.end();
  }
}

main().catch((err) => fail((err as Error).stack ?? String(err)));
