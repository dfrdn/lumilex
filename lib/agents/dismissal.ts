// ── Proposal dismissal taxonomy ──────────────────────────────────────
//
// Why a reviewer rejected a proposal is the highest-signal thing the review
// queue produces, and it decides how the proposal scores. `already_handled`
// says the agent was *right* and merely late — someone filed or calendared
// the same thing by hand first — so it must not count against precision.
// The other two are genuine misses, of different kinds.
//
// Fixed set on purpose, not an `enum_options` row: reports group on these
// values, so they have to keep meaning the same thing over time. Kept free
// of imports so the review UI can pull the labels without dragging the
// service-role client in `./proposals` into the browser bundle.

export const DISMISS_REASONS = ['already_handled', 'not_applicable', 'incorrect'] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number];

export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  already_handled: 'Already added manually',
  not_applicable: "Doesn't apply to this matter",
  incorrect: 'Detected details are wrong',
};

/**
 * Gloss shown beside each label in the reason picker. Kept to a fragment:
 * CellDropdown puts label and gloss on one truncating line.
 */
export const DISMISS_REASON_HINTS: Record<DismissReason, string> = {
  already_handled: 'we got there first',
  not_applicable: 'not a trigger, or wrong matter',
  incorrect: 'wrong rule set or date',
};

export function isDismissReason(value: unknown): value is DismissReason {
  return typeof value === 'string' && (DISMISS_REASONS as readonly string[]).includes(value);
}

/** True when the dismissal means the agent was right, just late. */
export function wasAgentCorrect(reason: DismissReason): boolean {
  return reason === 'already_handled';
}
