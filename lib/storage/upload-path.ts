/**
 * The one rule for two-phase uploads: a storage path that came back from the
 * client is a string the caller chose, and handing it to `createSignedUrl`,
 * `download` or `copy` under service-role reads whatever it points at — or
 * records it into a row that a later download route trusts.
 *
 * Phase 1 mints every path from the caller's firm and the entity it just
 * proved ownership of. Phase 2 re-derives the same prefix and checks the
 * supplied path against it here. Six inline `startsWith` calls is how one of
 * them drifts, so the comparison lives in one place with its own tests.
 *
 * A bare `startsWith` is not the comparison we want: `foo/bar` starts with
 * `foo/ba`, and `a/../b` starts with `a/`. The prefix is therefore matched at a
 * path-segment boundary, and a path carrying `.`/`..` segments, an empty
 * segment, a backslash, or a leading slash is rejected before the comparison.
 */

export type UploadPathRejection =
  /** No path supplied (missing, non-string, or whitespace only). */
  | 'empty'
  /** Leading `/` — an absolute key where the prefix is relative. */
  | 'absolute'
  /** A `.` or `..` segment, i.e. an attempt to climb out of the prefix. */
  | 'traversal'
  /** An empty segment (`//`, trailing `/`) or a backslash separator. */
  | 'malformed'
  /** Well-formed, but not under the server-derived prefix. */
  | 'outside-prefix';

export type UploadPathCheck =
  | { ok: true; path: string }
  | { ok: false; reason: UploadPathRejection };

export class UploadPathError extends Error {
  readonly reason: UploadPathRejection;

  constructor(reason: UploadPathRejection, prefix: string) {
    super(`Storage path rejected (${reason}); expected a path under "${prefix}"`);
    this.name = 'UploadPathError';
    this.reason = reason;
  }
}

/**
 * Normalize a server-derived prefix to end at a segment boundary. An empty
 * prefix would let everything through, so it throws rather than returning a
 * failure — it can only be a bug in the caller, never bad input.
 */
function normalizePrefix(prefix: string): string {
  if (typeof prefix !== 'string' || prefix.trim() === '') {
    throw new Error('upload-path: prefix must be a non-empty string');
  }
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

/**
 * Is `supplied` a well-formed object key that sits under `prefix`?
 *
 * `prefix` is treated as a folder: a trailing slash is added when missing, so
 * the prefix `foo/ba` never accepts `foo/bar`. The path must also name
 * something inside the prefix — the prefix on its own is a folder, not an
 * object.
 */
export function checkPathUnder(
  supplied: string | null | undefined,
  prefix: string,
): UploadPathCheck {
  const dir = normalizePrefix(prefix);

  if (typeof supplied !== 'string' || supplied.trim() === '') {
    return { ok: false, reason: 'empty' };
  }
  const path = supplied;

  if (path.startsWith('/')) return { ok: false, reason: 'absolute' };
  if (path.includes('\\')) return { ok: false, reason: 'malformed' };

  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '..') return { ok: false, reason: 'traversal' };
    if (segment === '') return { ok: false, reason: 'malformed' };
  }

  if (!path.startsWith(dir) || path.length === dir.length) {
    return { ok: false, reason: 'outside-prefix' };
  }

  return { ok: true, path };
}

/** `checkPathUnder`, as a boolean. */
export function isPathUnder(supplied: string | null | undefined, prefix: string): boolean {
  return checkPathUnder(supplied, prefix).ok;
}

/**
 * `checkPathUnder` that throws `UploadPathError` instead of returning a
 * failure, for call sites already inside a try/catch.
 */
export function assertPathUnder(supplied: string | null | undefined, prefix: string): string {
  const result = checkPathUnder(supplied, prefix);
  if (!result.ok) throw new UploadPathError(result.reason, normalizePrefix(prefix));
  return result.path;
}

/**
 * The supplied paths that are NOT under `prefix`, for the common batch commit.
 * An empty result means every path is acceptable; anything else is a 400 for
 * the whole request — a partial commit would record the good half and leave the
 * caller guessing which paths were refused.
 */
export function pathsNotUnder(
  supplied: readonly (string | null | undefined)[],
  prefix: string,
): { path: string; reason: UploadPathRejection }[] {
  const bad: { path: string; reason: UploadPathRejection }[] = [];
  for (const p of supplied) {
    const result = checkPathUnder(p, prefix);
    if (!result.ok) bad.push({ path: typeof p === 'string' ? p : String(p), reason: result.reason });
  }
  return bad;
}
