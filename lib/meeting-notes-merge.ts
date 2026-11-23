/**
 * Three-way merge for meeting notes, line by line. `base` is the text both
 * sides started from, `mine` the local edit, `theirs` what someone else saved.
 * Edits to different lines combine; where both changed the same lines
 * differently, both versions are kept between markers for a person to settle.
 */

export const CLASH_MINE = '[Your version]';
export const clashTheirs = (who: string) => `[${who}'s version]`;
export const CLASH_END = '[End of clash — keep what you want and delete the rest]';

export interface MergeResult {
  text: string;
  clashes: number;
}

/** Above this many line pairs the LCS table is too large; the whole text is one clash. */
const MAX_CELLS = 4_000_000;

/** For each line of `a`, the index of the line of `b` it is matched to (longest common subsequence), or -1. */
function match(a: string[], b: string[]): number[] | null {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out[i] = j;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);

export function mergeNotes(base: string, mine: string, theirs: string, theirName: string): MergeResult {
  if (mine === theirs || theirs === base) return { text: mine, clashes: 0 };
  if (mine === base) return { text: theirs, clashes: 0 };

  const O = base.split('\n');
  const A = mine.split('\n');
  const B = theirs.split('\n');
  const toA = match(O, A);
  const toB = match(O, B);

  const out: string[] = [];
  let clashes = 0;
  const clash = (a: string[], b: string[]) => {
    clashes++;
    out.push(CLASH_MINE, ...a, clashTheirs(theirName), ...b, CLASH_END);
  };
  const chunk = (o: string[], a: string[], b: string[]) => {
    if (same(a, o)) out.push(...b);
    else if (same(b, o) || same(a, b)) out.push(...a);
    else if (a.length === o.length && b.length === o.length) {
      // Both sides rewrote lines in place: settle each line on its own, so
      // neighbouring edits combine and only lines changed two ways clash.
      let pending: [string[], string[]] | null = null;
      for (let i = 0; i < o.length; i++) {
        if (a[i] === o[i] || b[i] === o[i] || a[i] === b[i]) {
          if (pending) clash(...pending);
          pending = null;
          out.push(a[i] === o[i] ? b[i] : a[i]);
        } else {
          pending = pending ?? [[], []];
          pending[0].push(a[i]);
          pending[1].push(b[i]);
        }
      }
      if (pending) clash(...pending);
    } else clash(a, b);
  };

  if (!toA || !toB) {
    clash(A, B);
    return { text: out.join('\n'), clashes };
  }

  let o = 0;
  let a = 0;
  let b = 0;
  for (let k = 0; k <= O.length; k++) {
    // A base line both sides kept is a fixed point; the end of the text is the last one.
    const stable = k === O.length || (toA[k] >= a && toB[k] >= b && toA[k] !== -1 && toB[k] !== -1);
    if (!stable) continue;
    const ak = k === O.length ? A.length : toA[k];
    const bk = k === O.length ? B.length : toB[k];
    chunk(O.slice(o, k), A.slice(a, ak), B.slice(b, bk));
    if (k < O.length) out.push(O[k]);
    o = k + 1;
    a = ak + 1;
    b = bk + 1;
  }
  return { text: out.join('\n'), clashes };
}
