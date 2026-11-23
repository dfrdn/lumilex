import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { brandPattern } from './brand-terms';

/**
 * CI check for the origin firm's name in every tracked file — the tree that is
 * published — and in the text inside Office files. The names come from
 * scripts/brand-terms.ts, which reads them from outside the tree; without a
 * term list the check says so and skips, and `--require-terms` makes that a
 * failure.
 *
 * The grep this replaced read `app lib components public` and `docs/guides`
 * only, and skipped binaries. So the DOCX letterhead templates carried the
 * origin firm's logo, roster and sign-off past every green run: a DOCX is a
 * zip, and grep never looked inside it. Neither did it look at `scripts/`,
 * where seed content is written into a tenant's database, or at migrations and
 * docs, which publish with everything else.
 *
 * What it still cannot see: images and PDFs. A screenshot of the origin firm
 * passes this check, which is why the guide screenshots need their own review.
 *
 * Exits 1 on any hit, 0 otherwise. Run:
 *   npx tsx scripts/audit-brand.ts
 */

const ROOT = path.resolve(__dirname, '..');
const OFFICE = /\.(docx|dotx|xlsx|pptx)$/i;

/** What git tracks: the tree that is published. Deleted-but-unstaged paths are skipped. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0')
    .filter((rel) => rel && fs.existsSync(path.join(ROOT, rel)));
}

async function officeHits(file: string, PATTERN: RegExp): Promise<string[]> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const hits: string[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.(xml|rels)$/.test(name)) continue;
    if (PATTERN.test(await entry.async('string'))) hits.push(name);
  }
  return hits;
}

async function main() {
  const PATTERN = brandPattern();
  if (!PATTERN) {
    const message = 'verify:brand — SKIPPED: no term list (.brand-terms or BRAND_TERMS; see scripts/brand-terms.ts)';
    if (process.argv.includes('--require-terms')) {
      console.error(message);
      process.exit(1);
    }
    console.warn(message);
    return;
  }
  const failures: string[] = [];
  for (const rel of trackedFiles()) {
    const file = path.join(ROOT, rel);
    if (fs.statSync(file).isDirectory()) continue;
    if (OFFICE.test(file)) {
      const parts = await officeHits(file, PATTERN);
      if (parts.length) failures.push(`${rel} (inside ${parts.join(', ')})`);
      continue;
    }
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) continue;
    if (PATTERN.test(buf.toString('utf8'))) failures.push(rel);
  }

  if (failures.length) {
    console.error(`verify:brand — origin-firm name found in ${failures.length} file(s):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('verify:brand — clean');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
