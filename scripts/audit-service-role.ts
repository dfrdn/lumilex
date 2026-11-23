import * as fs from 'fs';
import * as path from 'path';
import { TENANT_TABLES, TENANT_VIEWS } from '../lib/tenancy/tables.generated';

/**
 * CI check for service-role discipline: no file under app/ or lib/ may touch
 * a tenant table through the raw `@/lib/supabase` client unless it is on the
 * eslint guard's allowlist. The allowlist (permanent entries + the
 * TRANSITIONAL sweep list) is parsed out of eslint.config.mjs between its
 * marker comments — eslint.config.mjs is the single source of truth; this
 * script never duplicates the list.
 *
 * Exits 1 when a violation exists, 0 otherwise. Run:
 *   npx tsx scripts/audit-service-role.ts
 */

const ROOT = path.resolve(__dirname, '..');
const RAW_IMPORT = "from '@/lib/supabase'";
const TRANSITIONAL_MARKER = '-- TRANSITIONAL sweep list';
const END_MARKER = '-- end TRANSITIONAL sweep list';

function parseAllowlists(): { permanent: string[]; transitional: string[] } {
  const config = fs.readFileSync(path.join(ROOT, 'eslint.config.mjs'), 'utf-8');
  const ignoresStart = config.indexOf('ignores: [');
  const markerIdx = config.indexOf(TRANSITIONAL_MARKER);
  const endIdx = config.indexOf(END_MARKER);
  if (ignoresStart === -1 || markerIdx === -1 || endIdx === -1) {
    throw new Error('audit-service-role: marker comments not found in eslint.config.mjs');
  }
  const entries = (section: string) =>
    [...section.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\\+([[\]])/g, '$1'));
  return {
    permanent: entries(config.slice(ignoresStart, markerIdx)),
    transitional: entries(config.slice(markerIdx, endIdx)),
  };
}

function matchesAllowlist(file: string, patterns: string[]): boolean {
  return patterns.some((p) =>
    p.endsWith('/**') ? file.startsWith(p.slice(0, -2)) : file === p,
  );
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) yield full;
  }
}

function main() {
  const { permanent, transitional } = parseAllowlists();
  const transitionalSet = new Set(transitional);
  const fromCall = /\.from\(\s*['"]([A-Za-z0-9_]+)['"]/g;

  const violations: string[] = [];
  let transitionalHits = 0;

  for (const dir of ['app', 'lib']) {
    for (const abs of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, abs);
      const content = fs.readFileSync(abs, 'utf-8');
      if (!content.includes(RAW_IMPORT)) continue;
      if (matchesAllowlist(rel, permanent)) continue;
      if (transitionalSet.has(rel)) {
        transitionalHits += 1;
        continue;
      }
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        for (const match of line.matchAll(fromCall)) {
          if (TENANT_TABLES.has(match[1]) || TENANT_VIEWS.has(match[1])) {
            violations.push(`${rel}:${i + 1}  .from('${match[1]}') via raw service-role client`);
          }
        }
      });
    }
  }

  const stale = transitional.filter((p) => {
    const abs = path.join(ROOT, p);
    return !fs.existsSync(abs) || !fs.readFileSync(abs, 'utf-8').includes(RAW_IMPORT);
  });
  if (stale.length > 0) {
    console.warn(`Note: ${stale.length} transitional entries no longer import @/lib/supabase — prune them from eslint.config.mjs:`);
    for (const p of stale) console.warn(`  ${p}`);
  }

  if (violations.length > 0) {
    console.error('Tenant tables reached through the raw service-role client outside the transitional list.');
    console.error('Use getServiceDbForFirm(firmId) from @/lib/tenancy/service-db instead.\n');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }

  console.log(
    `audit-service-role: clean (${transitionalHits} files on the transitional sweep list, 0 violations)`,
  );
}

main();
