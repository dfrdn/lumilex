import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { linksFromRow, MissingMatterLinksError } from './matter-links';

describe('linksFromRow', () => {
  it('reads each scope off the embedded links', () => {
    expect(
      linksFromRow({
        id: 'c1',
        subject: { matter_subjects: [{ matter_id: 'm-ret', scope: 'retainer' }, { matter_id: 'm-inc', scope: 'incorporation' }] },
      }),
    ).toEqual({ incorporation: 'm-inc', post_incorporation: null, housekeeping: null, retainer: 'm-ret' });
  });

  it('ignores scopes that are not corporate', () => {
    expect(linksFromRow({ id: 't1', subject: { matter_subjects: [{ matter_id: 'm', scope: 'trademark' }] } }).retainer).toBeNull();
  });

  it('treats a subject with no links as covered by no matter', () => {
    expect(Object.values(linksFromRow({ id: 'c1', subject: null }))).toEqual([null, null, null, null]);
  });

  it('refuses a row read without the embed', () => {
    expect(() => linksFromRow({ id: 'c1' })).toThrow(MissingMatterLinksError);
  });
});

describe('corporation queries', () => {
  // A corporation read with plain `*` has no matter links, so rowToCorporation
  // throws at runtime. Catch it here instead: no file that maps corporation
  // rows may select them with '*'.
  it('select CORPORATION_SELECT wherever rows feed rowToCorporation', () => {
    const files = execFileSync('git', ['grep', '-l', 'rowToCorporation(', '--', 'app', 'lib', 'scripts'], { encoding: 'utf8' })
      .split('\n')
      .filter((f) => f && !f.includes('.test.'));
    const offenders = files.filter((f) => /from\('corporations'\)(?:(?!\.from\()[^;])*?\.select\('\*'\)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
