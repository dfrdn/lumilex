import { execFileSync, spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { readLedger } from './migration-ledger';

/**
 * Stand up a complete Lumilex on this machine, against the local Supabase
 * stack, in one command:
 *
 *   npm run setup:local
 *   npm run setup:local -- --firm my-firm.json --operator you@your-firm.ph
 *
 *   1. starts the stack (`supabase start`) if it is not running;
 *   2. writes .env.local for it, with fresh CRON_SECRET and
 *      INTEGRATION_CREDS_KEY, unless one exists already;
 *   3. builds the database (scripts/bootstrap-database.ts) if it is empty;
 *   4. provisions a firm from a config (default scripts/self-host/firm.example.json);
 *   5. makes a platform operator, if --operator names one.
 *
 * Every step is safe to re-run: an existing .env.local is used, not replaced;
 * a database that already has migrations is left to `npm run fleet:migrate`;
 * provisioning fills what is absent and never overwrites. Passwords it creates
 * are printed once and stored nowhere.
 *
 * --env-path writes and reads another file than .env.local, for a checkout
 * whose .env.local already points at a hosted project.
 */

const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'http://localhost:3000';

interface Args {
  envFile: string;
  firmConfig: string;
  operatorEmail: string | null;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    envFile: path.join(ROOT, '.env.local'),
    firmConfig: path.join(ROOT, 'scripts', 'self-host', 'firm.example.json'),
    operatorEmail: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env-path') args.envFile = path.resolve(argv[++i] ?? fail('--env-path needs a path'));
    else if (a === '--firm') args.firmConfig = path.resolve(argv[++i] ?? fail('--firm needs a config path'));
    else if (a === '--operator') args.operatorEmail = argv[++i] ?? fail('--operator needs an email');
    else fail(`unknown argument ${a}`);
  }
  return args;
}

function step(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

interface StackStatus {
  API_URL: string;
  DB_URL: string;
  PUBLISHABLE_KEY: string;
  SERVICE_ROLE_KEY: string;
}

function stackStatus(): StackStatus | null {
  try {
    const out = execFileSync('supabase', ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const json = JSON.parse(out.slice(out.indexOf('{')));
    return json.API_URL && json.DB_URL ? json : null;
  } catch {
    return null;
  }
}

function readEnvFile(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^(["'])(.*)\1$/, '$2');
  }
  return env;
}

/** .env.local.example with the local stack's values and fresh secrets filled in. */
function localEnvFile(stack: StackStatus): string {
  const values: Record<string, string> = {
    APP_BASE_URL: APP_URL,
    SUPABASE_URL: stack.API_URL,
    SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: stack.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.PUBLISHABLE_KEY,
    CRON_SECRET: randomBytes(32).toString('hex'),
    INTEGRATION_CREDS_KEY: randomBytes(32).toString('base64'),
  };
  const template = fs.readFileSync(path.join(ROOT, '.env.local.example'), 'utf8');
  return template.replace(/^([A-Z0-9_]+)=.*$/gm, (line, key: string) => (key in values ? `${key}=${values[key]}` : line));
}

/** Runs a repo script with the instance's env in front of whatever .env.local holds. */
function runScript(script: string, scriptArgs: string[], env: Record<string, string>): void {
  const res = spawnSync('npx', ['tsx', path.join('scripts', script), ...scriptArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) fail(`${script} failed`);
}

async function ledgerEmpty(dbUrl: string): Promise<boolean> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const ledger = await readLedger(client);
    return !ledger || ledger.length === 0;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.firmConfig)) fail(`no firm config at ${args.firmConfig}`);

  step('Supabase stack');
  let stack = stackStatus();
  if (!stack) {
    console.log('Not running — starting it (the first start downloads the images).');
    const res = spawnSync('supabase', ['start'], { cwd: ROOT, stdio: 'inherit' });
    if (res.status !== 0) fail('supabase start failed — is Docker running?');
    stack = stackStatus() ?? fail('the stack started but `supabase status` reports nothing');
  }
  console.log(`API ${stack.API_URL}, database ${stack.DB_URL.replace(/:[^:@/]+@/, ':***@')}`);

  step(`Environment (${path.relative(ROOT, args.envFile)})`);
  if (fs.existsSync(args.envFile)) {
    const existing = readEnvFile(args.envFile);
    if (existing.SUPABASE_URL !== stack.API_URL) {
      fail(
        `${path.relative(ROOT, args.envFile)} points at ${existing.SUPABASE_URL || 'no Supabase project'}, not the local stack. ` +
          'Move it aside, or pass --env-path <another path> and run the app with that file.',
      );
    }
    console.log('Exists and points at the local stack — using it as it is.');
  } else {
    fs.writeFileSync(args.envFile, localEnvFile(stack), { mode: 0o600 });
    console.log('Written, with a fresh CRON_SECRET and INTEGRATION_CREDS_KEY.');
  }
  const env = readEnvFile(args.envFile);
  const instanceEnv: Record<string, string> = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== ''),
  );

  step('Database');
  if (await ledgerEmpty(stack.DB_URL)) {
    runScript('bootstrap-database.ts', ['--db-url', stack.DB_URL, '--cron-secret', env.CRON_SECRET], instanceEnv);
  } else {
    console.log('Already built. Bring it current with: npm run fleet:migrate (see docs/self-hosting.md)');
  }

  step(`Firm (${path.relative(ROOT, args.firmConfig)})`);
  runScript('provision-firm.ts', [args.firmConfig], instanceEnv);

  if (args.operatorEmail) {
    step('Platform operator');
    const password = randomBytes(12).toString('base64url');
    runScript('bootstrap-platform-operator.ts', [args.operatorEmail, password, 'Operator'], instanceEnv);
    console.log(`  password (shown once): ${password}`);
  }

  step('Ready');
  console.log(`Start the app with the same environment and open ${APP_URL}:`);
  console.log(args.envFile === path.join(ROOT, '.env.local')
    ? '  npm run dev'
    : `  set -a; . ${path.relative(ROOT, args.envFile)}; set +a; npm run dev`);
  console.log('Sign in as the firm admin printed above. Mail the stack sends lands in Mailpit at http://127.0.0.1:54324.');
}

main().catch((err) => fail((err as Error).stack ?? String(err)));
