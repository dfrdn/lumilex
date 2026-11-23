import * as fs from 'fs';
import * as path from 'path';

/**
 * CI check for route authentication: every exported HTTP handler under
 * `app/api` must establish who is calling, or be named here with the reason it
 * doesn't.
 *
 * Why this exists. proxy.ts's matcher excludes 21 path prefixes, and a route
 * under one of them that forgets its own check is not degraded — it is fully
 * open to the internet. Two shipped that way:
 *
 *   - `/api/admin/claude-files` listed and DELETED Claude Files API content
 *     across every tenant, with no session check at all.
 *   - `/api/file-analysis/auto` took an arbitrary `fileId` and, with no
 *     `firmId`, resolved it through the raw service-role client across every
 *     firm — so a guessed id triggered AI analysis on another tenant's
 *     document. Its DB webhook had been sending `Authorization: Bearer
 *     <cron_secret>` the whole time. The route never looked.
 *
 * Both were found by reading code, which is not a gate. This is the gate.
 *
 * What counts as authentication is deliberately broad — `getSession`,
 * `getPortalSession`, `getOperatorSession` / `requireOperator`,
 * `requirePortalSession`, a `CRON_SECRET` bearer check, `getAuthUserId`, or
 * Supabase's own `auth.getUser`. This check answers "does this handler
 * establish a caller at all", not "is the authorization correct" — the second
 * question needs a human, and `/api/admin/file-upload` is why: it authenticated
 * fine and still let any signed-in staff member delete any firm file, because
 * it never checked a role. A green run here is not a claim that every handler
 * authorizes correctly.
 *
 * Exits 1 on any unlisted handler. Run:
 *   npx tsx scripts/audit-route-auth.ts
 */

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'app', 'api');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const METHOD_RE = `(?:${METHODS.join('|')})`;

/** `export async function GET(`, `export function GET(`, `export const GET = ` */
const HANDLER = new RegExp(
  `^export\\s+(?:async\\s+)?function\\s+(${METHOD_RE})\\b|^export\\s+const\\s+(${METHOD_RE})\\s*=`,
  'gm',
);

/**
 * Anything that establishes who is calling. Not a judgement about whether the
 * handler then authorizes correctly — see the note above.
 */
const AUTH_SIGNALS: { name: string; re: RegExp }[] = [
  { name: 'getSession', re: /\bgetSession\s*\(/ },
  { name: 'getPortalSession', re: /\bgetPortalSession\s*\(/ },
  { name: 'requirePortalSession', re: /\brequirePortalSession\s*\(/ },
  { name: 'operator', re: /\b(?:getOperatorSession|requireOperator)\s*\(/ },
  { name: 'CRON_SECRET', re: /CRON_SECRET/ },
  { name: 'getAuthUserId', re: /\bgetAuthUserId\s*\(/ },
  { name: 'auth.getUser', re: /auth\.getUser\s*\(/ },
];

/**
 * Handlers that are unauthenticated on purpose, keyed `<route> <METHOD>` and
 * grouped by reason.
 *
 * Per method, not per file: adding a POST to a route whose GET is listed here
 * must fail until somebody says why. That is the whole ratchet.
 */
const ALLOWLIST: Record<string, readonly string[]> = {
  'bearer credential in the URL — the caller is a calendar client that cannot follow a redirect to /login; the token is resolved by the handler and an unknown one gets a bare 404 that reveals nothing':
    ['app/api/calendar/[token]/route.ts GET'],

  'dev-only impersonation, 404 unless NODE_ENV === "development"':
    [
      'app/api/dev/team-signin/route.ts GET',
      'app/api/dev/portal-signin/route.ts GET',
    ],

  'public by design, and safe by construction rather than by check — the asset slot is validated against an enum and the object key comes from the firm\'s stored branding config, never from the request':
    ['app/api/public/brand/[firmId]/[asset]/route.ts GET'],

  'the public demo\'s one-click sign-in — how a visitor becomes a caller; it signs in only as a persona the host\'s firm registered in settings.demo, only on a deployment with LUMILEX_INSTANCE_ROLE=demo, and never as a super_user (lib/demo/sign-in.ts)':
    ['app/api/auth/demo/route.ts GET'],

  'the public demo\'s request for access — a visitor gives a name, work email and position before the demo signs them in; zod-validated, a honeypot field, a per-IP throttle, refused off a demo deployment, and it signs in only through the same persona checks as the GET (lib/demo/access.ts)':
    ['app/api/auth/demo/route.ts POST'],

  'public intake form; defended in depth instead — zod per form kind, a honeypot field, a per-IP throttle, a per-email daily cap, and submissions quarantined in intake_submissions rather than written to clients':
    ['app/api/public/intake/route.ts POST'],
};

const ALLOWED = new Map<string, string>();
for (const [reason, entries] of Object.entries(ALLOWLIST)) {
  for (const entry of entries) ALLOWED.set(entry, reason);
}

interface Finding {
  route: string;
  method: string;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name === 'route.ts') yield p;
  }
}

/**
 * The body of a function whose signature starts at `from`.
 *
 * Two traps, both of which produced phantom findings the first time this sweep
 * was run by hand:
 *
 *   1. `export async function GET(req, { params })` — a naive scan for the
 *      first `{` finds the destructured *parameter*, not the body, and reads
 *      the handler as empty. So paren-match the parameter list first.
 *   2. `async function f(...): Promise<{ ok: boolean }> {` — the first `{`
 *      after the parameters belongs to the return type. Skip anything inside
 *      angle brackets in the annotation between `)` and the real body.
 *
 * Together those two hid guards behind eleven handlers, including all four
 * portal file routes.
 */
function functionBody(src: string, from: number): string | null {
  const open = src.indexOf('(', from);
  if (open === -1) return null;

  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) break;
  }
  if (i >= src.length) return null;

  // Between the `)` and the body there may be `: SomeType<{ ... }>`.
  let angle = 0;
  let j = i + 1;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '<') angle++;
    else if (c === '>') angle--;
    else if (c === '{' && angle <= 0) break;
  }
  if (j >= src.length) return null;

  depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(j, k + 1);
  }
  return null;
}

/** Auth signals in `body`, or in one local helper it calls. */
function authSignals(src: string, body: string): string[] {
  const direct = AUTH_SIGNALS.filter((s) => s.re.test(body)).map((s) => s.name);
  if (direct.length > 0) return direct;

  // One level of delegation: `const guard = await requireX()` where requireX is
  // declared in this file. Deeper chains are rare and deliberately not chased —
  // the allowlist is the escape hatch, not a smarter parser.
  const called = new Set(Array.from(body.matchAll(/\b(\w+)\s*\(/g), (m) => m[1]));
  for (const name of called) {
    for (const pattern of [
      `(?:async\\s+)?function\\s+${name}\\s*\\(`,
      `const\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`,
    ]) {
      const decl = new RegExp(pattern).exec(src);
      if (!decl) continue;
      const helper = functionBody(src, decl.index);
      if (!helper) continue;
      const hits = AUTH_SIGNALS.filter((s) => s.re.test(helper)).map(
        (s) => `${s.name} (via ${name})`,
      );
      if (hits.length > 0) return hits;
    }
  }
  return [];
}

function main(): void {
  const unguarded: Finding[] = [];
  const unparsed: string[] = [];
  const seenAllowed = new Set<string>();
  let handlers = 0;
  let files = 0;

  for (const file of walk(API_DIR)) {
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, 'utf8');
    files++;

    let found = 0;
    HANDLER.lastIndex = 0;
    for (let m = HANDLER.exec(src); m !== null; m = HANDLER.exec(src)) {
      const method = m[1] ?? m[2];
      found++;
      handlers++;

      const body = functionBody(src, m.index + m[0].length - 1);
      // An unreadable handler is reported, never skipped: a parser that silently
      // drops what it cannot read is worse than no check, because the run is
      // still green.
      if (body === null) {
        unparsed.push(`${rel} ${method}`);
        continue;
      }

      if (authSignals(src, body).length > 0) continue;

      const key = `${rel} ${method}`;
      if (ALLOWED.has(key)) {
        seenAllowed.add(key);
        continue;
      }
      unguarded.push({ route: rel, method });
    }

    // A route file is here to export handlers. Zero means a form this scanner
    // does not recognise, which would otherwise pass as "nothing to check".
    if (found === 0) unparsed.push(`${rel} (no exported handler recognised)`);
  }

  const stale = [...ALLOWED.keys()].filter((k) => !seenAllowed.has(k));
  if (stale.length > 0) {
    console.warn(
      `Note: ${stale.length} allowlist entr${stale.length === 1 ? 'y no longer matches' : 'ies no longer match'} an unguarded handler — prune from ALLOWLIST in this file:`,
    );
    for (const k of stale) console.warn(`  ${k}`);
    console.warn('');
  }

  if (unguarded.length === 0 && unparsed.length === 0) {
    console.log(
      `audit-route-auth: clean (${handlers} handlers across ${files} route files, ${ALLOWED.size} unauthenticated by design)`,
    );
    process.exit(0);
  }

  if (unparsed.length > 0) {
    console.error(`✗ ${unparsed.length} handler(s) this check could not read:\n`);
    for (const u of unparsed) console.error(`  ${u}`);
    console.error('\nTeach functionBody/HANDLER the new shape — do not allowlist it.\n');
  }

  if (unguarded.length > 0) {
    console.error(`✗ ${unguarded.length} handler(s) with no authentication:\n`);
    for (const f of unguarded) console.error(`  ${f.method.padEnd(7)} ${f.route}`);
    console.error(
      '\nEstablish the caller — getSession(), requirePortalSession(), requireOperator(),\n' +
        'or a CRON_SECRET bearer check. proxy.ts excludes 21 prefixes from its matcher, so\n' +
        'a route under one of them with no check of its own is open to anyone.\n' +
        'If it is unauthenticated on purpose, add it to ALLOWLIST with the reason.\n',
    );
  }

  process.exit(1);
}

main();
