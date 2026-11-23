import * as fs from 'fs';
import * as path from 'path';
import { scanSource, type PersonShapeHit } from '../lib/debrand/person-shaped';

/**
 * CI check for person-shaped constants: no short opaque token may sit in a
 * per-person-allocation position (`ADC: 0.40`) or a string-union
 * (`'standard' | 'qzx'`) unless it is named in ALLOWED_TOKENS with a reason.
 *
 * This is the gate `verify:brand` cannot be. That one greps for the firm's
 * NAME; a real person encoded as initials passes it every time, and did —
 * twice, in `lib/`, for months. See lib/debrand/person-shaped.ts for both.
 *
 * The rule and the allowlist live in lib/debrand/person-shaped.ts so the
 * negative controls run in the unit suite; this file is the IO around it.
 *
 * Exits 1 when an unnamed token exists, 0 otherwise. Run:
 *   npx tsx scripts/audit-person-shaped.ts
 */

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['app', 'lib', 'components', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);
const DOCUMENTS_THE_RULE = new Set([
  'lib/debrand/person-shaped.ts',
  'lib/debrand/person-shaped.test.ts',
  'scripts/audit-person-shaped.ts',
]);

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(p);
    } else if (/\.tsx?$/.test(entry.name)) {
      yield p;
    }
  }
}

function main(): void {
  const violations: (PersonShapeHit & { file: string })[] = [];
  let scanned = 0;

  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file);
      // These three quote both constants (stand-in initials, the real shape) — the module to explain
      // the rule, the test to prove it still fires, this file to document what
      // a failure means. Scanning them makes the gate fail on its own evidence,
      // and rewording the canonical example to dodge the detector would be
      // worse than exempting the three files that are allowed to state it.
      if (DOCUMENTS_THE_RULE.has(rel)) continue;
      scanned++;
      for (const hit of scanSource(fs.readFileSync(file, 'utf-8'))) {
        violations.push({ ...hit, file: rel });
      }
    }
  }

  if (violations.length > 0) {
    const distinct = [...new Set(violations.map((v) => v.token))].sort();
    console.error(
      `Short opaque token${distinct.length === 1 ? '' : 's'} in a person-shaped position: ${distinct.join(', ')}\n`,
    );
    console.error('Each one is either a person or a thing, and this gate cannot tell them apart.');
    console.error('  • a person (initials, a nickname) → remove it; it must not ship to a tenant');
    console.error('  • a thing (an agency, a format, a unit) → add it to the right group in');
    console.error('    lib/debrand/person-shaped.ts → ALLOWED_TOKENS\n');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  [${v.position}] ${v.token}`);
      console.error(`      ${v.text}`);
    }
    process.exit(1);
  }

  console.log(`audit-person-shaped: clean (${scanned} files scanned, 0 unnamed tokens)`);
}

main();
