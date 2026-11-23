import * as fs from 'fs';
import * as path from 'path';

/**
 * The names `verify:brand` and `render-brand-samples` look for: the firm this
 * code was forked from, its people and its mail domains.
 *
 * They are deliberately not in the tree. A check that spells out the name it
 * guards against publishes that name, which is the one thing it exists to
 * prevent. So the list lives in an untracked `.brand-terms` file at the repo
 * root (one term per line, `#` for comments) or in `BRAND_TERMS`
 * (comma-separated), on the machines that hold the history it came from.
 *
 * Matching is case-insensitive and by substring, so a term catches its
 * camel-cased, hyphenated and domain forms too.
 */
export function brandTerms(): string[] {
  const fromEnv = process.env.BRAND_TERMS?.split(',') ?? [];
  const file = path.resolve(__dirname, '..', '.brand-terms');
  const fromFile = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  return [...new Set(
    [...fromEnv, ...fromFile]
      .map((t) => t.replace(/#.*/, '').trim().toLowerCase())
      .filter(Boolean),
  )];
}

/** One case-insensitive pattern over every term, or null when there are none. */
export function brandPattern(terms: string[] = brandTerms()): RegExp | null {
  if (!terms.length) return null;
  return new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
}
