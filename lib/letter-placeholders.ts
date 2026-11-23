/**
 * Placeholders in an editable letter — `{{key}}` in what is stored, a chip in
 * the editor (components/LetterEditor.tsx). Shared by the billing letter and
 * the billing email, each with its own set of keys.
 */

export interface LetterPlaceholder {
  key: string;
  /** What the chip reads, e.g. "Applicant name". */
  label: string;
  /** What it is filled with, for the chip's tooltip. */
  meaning: string;
}

const CHIP = /<span\b[^>]*\bdata-placeholder="([A-Za-z0-9_]+)"[^>]*>[\s\S]*?<\/span>/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A token for any of these keys, however it is spaced or cased: `{{ Name }}`. */
export function tokenPattern(keys: readonly string[]): RegExp {
  return new RegExp(`\\{\\{\\s*(${keys.map(escapeRe).join('|')})\\s*\\}\\}`, 'gi');
}

/** The key as the set spells it, for a token typed in another case. */
export function canonicalKey(keys: readonly string[], typed: string): string {
  return keys.find((k) => k.toLowerCase() === typed.toLowerCase()) ?? typed;
}

/** The editor's chips back to their tokens, which is how a letter is stored. */
export function chipsToTokens(html: string): string {
  return html.replace(CHIP, (_, key: string) => `{{${key}}}`);
}

/** Tokens to the chips the editor shows. Unknown ones stay as typed, so they can be seen and fixed. */
export function tokensToChips(html: string, keys: readonly string[]): string {
  if (keys.length === 0) return html;
  return html.replace(tokenPattern(keys), (_, key: string) => `<span data-placeholder="${canonicalKey(keys, key)}"></span>`);
}
