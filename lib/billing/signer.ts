/**
 * The signer on a billing letter is typed in finance's style — "ANDRES MIGUEL B.
 * SANTOS" — while the roster says "Andres Miguel Santos". Compared without case,
 * punctuation or middle initials, the two are the same person.
 */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .join(' ');
}

/** The roster position of the one person the signer's name matches, else undefined. */
export function positionForSigner(
  signerName: string,
  roster: { name: string | null; position: string | null }[],
): string | undefined {
  const key = nameKey(signerName);
  if (!key) return undefined;
  const matches = roster.filter((r) => r.name && nameKey(r.name) === key);
  return matches.length === 1 && matches[0].position?.trim() ? matches[0].position.trim() : undefined;
}

export interface LetterSigner { name: string; position?: string }

/**
 * Who signs a billing letter: the Managing Partner — the one active roster
 * member holding that position, by the same test as `isManagingPartner`.
 * The firm's configured signer stands in only when the roster has no single
 * Managing Partner, so an invoice never goes out unsigned.
 */
export function billingLetterSigner(
  roster: { name: string | null; position: string | null; active?: boolean | null }[],
  fallbackName: string | undefined,
): LetterSigner | null {
  const mps = roster.filter((r) => r.active !== false && r.position === 'Managing Partner' && r.name?.trim());
  if (mps.length === 1) return { name: mps[0].name!.trim(), position: 'Managing Partner' };
  const name = fallbackName?.trim();
  return name ? { name, position: positionForSigner(name, roster) } : null;
}
