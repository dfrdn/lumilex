/**
 * Which letterhead a firm's Word documents are set on. Client-safe: the
 * /platform editor lists these, and `lib/docx/letterhead.ts` draws them.
 *
 * A firm may name one in `branding.letterhead`; left on `auto`, one is chosen
 * from its document name. The choice is a stable hash, so a firm keeps the same
 * letterhead from one letter to the next, and two firms set up the same day are
 * unlikely to share one — without anybody having had to pick.
 */

export const LETTERHEAD_DESIGNS = ['classic', 'band', 'ledger'] as const;
export type LetterheadDesign = (typeof LETTERHEAD_DESIGNS)[number];
export type LetterheadSetting = LetterheadDesign | 'auto';

export const LETTERHEAD_LABELS: Record<LetterheadDesign, string> = {
  classic: 'Classic — centred name, roster across the foot',
  band: 'Band — the name reversed out of a band in the primary colour',
  ledger: 'Ledger — name and address ranged left and right over a double rule',
};

/** FNV-1a over the name as it is printed, case and spacing aside. */
function nameHash(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of name.trim().replace(/\s+/g, ' ').toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The design a firm's letters use: its own choice, or one seeded from its name. */
export function pickLetterheadDesign(setting: LetterheadSetting, firmName: string): LetterheadDesign {
  if (setting !== 'auto') return setting;
  return LETTERHEAD_DESIGNS[nameHash(firmName) % LETTERHEAD_DESIGNS.length];
}
