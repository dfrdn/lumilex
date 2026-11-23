import { describe, it, expect } from 'vitest';
import {
  checkPathUnder,
  isPathUnder,
  assertPathUnder,
  pathsNotUnder,
  UploadPathError,
} from './upload-path';

const FIRM = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const PREFIX = `${FIRM}/deliv-abc/v3/`;

describe('checkPathUnder', () => {
  it('accepts a path minted under the prefix', () => {
    const result = checkPathUnder(`${PREFIX}Motion_to_Dismiss.docx`, PREFIX);
    expect(result).toEqual({ ok: true, path: `${PREFIX}Motion_to_Dismiss.docx` });
  });

  it('accepts a prefix passed without its trailing slash', () => {
    expect(isPathUnder(`${FIRM}/deliv-abc/v3/a.pdf`, `${FIRM}/deliv-abc/v3`)).toBe(true);
  });

  it('accepts a nested path under the prefix', () => {
    expect(isPathUnder(`${PREFIX}annex/a.pdf`, PREFIX)).toBe(true);
  });

  it('rejects the prefix itself — a folder is not an object', () => {
    expect(checkPathUnder(PREFIX, PREFIX)).toEqual({ ok: false, reason: 'malformed' });
    expect(checkPathUnder(PREFIX.slice(0, -1), PREFIX)).toEqual({
      ok: false,
      reason: 'outside-prefix',
    });
  });

  it("rejects a sibling-prefix near-miss — 'foo/bar' does not sit under 'foo/ba'", () => {
    expect(checkPathUnder('foo/bar', 'foo/ba')).toEqual({ ok: false, reason: 'outside-prefix' });
    expect(isPathUnder('foo/bar/x.pdf', 'foo/ba')).toBe(false);
    // The same shape with real ids: v3 must not accept v30.
    expect(isPathUnder(`${FIRM}/deliv-abc/v30/a.pdf`, `${FIRM}/deliv-abc/v3/`)).toBe(false);
  });

  it("rejects a path escaping the prefix via '..'", () => {
    expect(checkPathUnder(`${PREFIX}../../${OTHER}/secret.pdf`, PREFIX)).toEqual({
      ok: false,
      reason: 'traversal',
    });
    expect(checkPathUnder(`${PREFIX}..`, PREFIX)).toEqual({ ok: false, reason: 'traversal' });
    // A '.' segment is the same class of trick.
    expect(checkPathUnder(`${PREFIX}./a.pdf`, PREFIX)).toEqual({ ok: false, reason: 'traversal' });
    // '..' inside a filename is not a segment and stays legal.
    expect(isPathUnder(`${PREFIX}report..final.pdf`, PREFIX)).toBe(true);
  });

  it('rejects an absolute path against a relative prefix, and vice versa', () => {
    expect(checkPathUnder(`/${PREFIX}a.pdf`, PREFIX)).toEqual({ ok: false, reason: 'absolute' });
    expect(checkPathUnder(`${PREFIX}a.pdf`, `/${PREFIX}`)).toEqual({
      ok: false,
      reason: 'outside-prefix',
    });
  });

  it('rejects an empty or missing supplied path', () => {
    expect(checkPathUnder('', PREFIX)).toEqual({ ok: false, reason: 'empty' });
    expect(checkPathUnder('   ', PREFIX)).toEqual({ ok: false, reason: 'empty' });
    expect(checkPathUnder(undefined, PREFIX)).toEqual({ ok: false, reason: 'empty' });
    expect(checkPathUnder(null, PREFIX)).toEqual({ ok: false, reason: 'empty' });
    expect(checkPathUnder(undefined as unknown as string, PREFIX).ok).toBe(false);
  });

  it('rejects another firm’s object, which is the whole point', () => {
    expect(checkPathUnder(`${OTHER}/deliv-abc/v3/a.pdf`, PREFIX)).toEqual({
      ok: false,
      reason: 'outside-prefix',
    });
    // Same entity id, different firm prefix — an entity-id-only check would pass this.
    expect(isPathUnder(`${OTHER}/deliv-abc/v3/a.pdf`, PREFIX)).toBe(false);
  });

  it('rejects empty segments and backslash separators', () => {
    expect(checkPathUnder(`${PREFIX}/a.pdf`, PREFIX)).toEqual({ ok: false, reason: 'malformed' });
    expect(checkPathUnder(`${PREFIX}a//b.pdf`, PREFIX)).toEqual({ ok: false, reason: 'malformed' });
    expect(checkPathUnder(`${PREFIX}sub\\a.pdf`, PREFIX)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a full URL supplied in place of a key', () => {
    expect(
      checkPathUnder(`https://example.supabase.co/storage/v1/object/sign/files/${PREFIX}a.pdf`, PREFIX).ok,
    ).toBe(false);
  });

  it('throws on an empty prefix rather than accepting everything', () => {
    expect(() => checkPathUnder('anything/at/all.pdf', '')).toThrow(/non-empty/);
    expect(() => checkPathUnder('anything/at/all.pdf', '   ')).toThrow(/non-empty/);
  });
});

describe('assertPathUnder', () => {
  it('returns the path when it is under the prefix', () => {
    expect(assertPathUnder(`${PREFIX}a.pdf`, PREFIX)).toBe(`${PREFIX}a.pdf`);
  });

  it('throws UploadPathError carrying the reason', () => {
    try {
      assertPathUnder(`${OTHER}/x.pdf`, PREFIX);
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UploadPathError);
      expect((err as UploadPathError).reason).toBe('outside-prefix');
      // The message names the expected prefix, never whether the object exists.
      expect((err as UploadPathError).message).toContain(PREFIX);
      expect((err as UploadPathError).message).not.toMatch(/exist|found/i);
    }
  });
});

describe('pathsNotUnder', () => {
  it('is empty when every path is under the prefix', () => {
    expect(pathsNotUnder([`${PREFIX}a.pdf`, `${PREFIX}b.docx`], PREFIX)).toEqual([]);
  });

  it('reports each offending path with its reason', () => {
    expect(
      pathsNotUnder([`${PREFIX}a.pdf`, `${OTHER}/b.pdf`, undefined, `${PREFIX}../c.pdf`], PREFIX),
    ).toEqual([
      { path: `${OTHER}/b.pdf`, reason: 'outside-prefix' },
      { path: 'undefined', reason: 'empty' },
      { path: `${PREFIX}../c.pdf`, reason: 'traversal' },
    ]);
  });
});
