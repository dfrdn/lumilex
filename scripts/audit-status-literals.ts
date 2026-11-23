import * as fs from 'fs';
import * as path from 'path';
import {
  findStatusLiterals,
  evaluateStatusLiterals,
  ALLOWED_STATUS_LITERALS,
  type StatusLiteralHit,
} from '../lib/deliverable-status-literals';

/**
 * CI check: no deliverable status spelled as a bare string outside
 * lib/deliverable-status.ts, unless counted with a reason in
 * ALLOWED_STATUS_LITERALS. See lib/deliverable-status-literals.ts for why.
 *
 * Exits 1 on a literal over its allowance, 0 otherwise. Run:
 *   npx tsx scripts/audit-status-literals.ts
 */

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['app', 'lib', 'components', 'hooks'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);
/**
 * The vocabulary itself, the rule that quotes it, and the two other entities'
 * vocabularies that happen to share a word with it ('Archived' for matters,
 * 'Not started' for tasks) — the collision is the reason each has its own
 * module.
 */
const EXEMPT = new Set([
  'lib/deliverable-status.ts',
  'lib/deliverable-status-literals.ts',
  'lib/matter-status.ts',
  'lib/task-status.ts',
]);
/** Tests assert on the stored values themselves, which is their job. */
const isTest = (rel: string) => /\.test\.tsx?$/.test(rel);

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(p);
    } else if (/\.tsx?$/.test(entry.name)) {
      yield p;
    }
  }
}

function main(): void {
  const hitsByFile: Record<string, StatusLiteralHit[]> = {};
  let scanned = 0;
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file);
      if (EXEMPT.has(rel) || isTest(rel)) continue;
      scanned++;
      const hits = findStatusLiterals(fs.readFileSync(file, 'utf-8'), rel);
      if (hits.length) hitsByFile[rel] = hits;
    }
  }

  const { violations, stale } = evaluateStatusLiterals(hitsByFile, ALLOWED_STATUS_LITERALS);

  for (const s of stale) {
    console.warn(`  stale allowance  ${s.file}  '${s.literal}' allowed ${s.allowed}, found ${s.found} — shrink it`);
  }
  if (violations.length === 0) {
    console.log(`audit-status-literals: clean (${scanned} files scanned)`);
    return;
  }
  console.error('\nBare deliverable status strings outside lib/deliverable-status.ts:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.lines.join(',')}  '${v.literal}'${v.allowed ? ` (allowed ${v.allowed})` : ''}`);
  }
  console.error(
    `\n${violations.length} violation(s). Use DELIVERABLE_STATUS / a role from lib/deliverable-status.ts,` +
      ' or — if the string is another entity\'s value — add it to ALLOWED_STATUS_LITERALS with its reason.\n',
  );
  process.exit(1);
}

main();
