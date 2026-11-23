/**
 * Shared annex helpers used by the finalize API, the finalize UI, and the
 * client portal so the naming scheme lives in exactly one place.
 *
 * Annexes are supplementary files attached to a finalized deliverable. Each is
 * stored as a `deliverable_files` row named `Annex {LETTER} - {label}.{ext}`.
 */

/**
 * Bijective base-26 letter for a 0-based index: 0→A, 25→Z, 26→AA, 27→AB, …
 * (so attaching more than 26 annexes never produces a non-letter like '[').
 */
export function annexLetter(index: number): string {
  let n = Math.floor(index) + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || 'A';
}

const ANNEX_NAME_RE = /^Annex [A-Z]+ - /;

/** True if a deliverable file's display name is an attached annex. */
export function isAnnexFile(fileName: string | null | undefined): boolean {
  return !!fileName && ANNEX_NAME_RE.test(fileName);
}
