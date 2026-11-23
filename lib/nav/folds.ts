/*
 * Folding a sidebar group. The person's saved choice wins: a group they
 * folded stays folded, even on one of its own pages. A group they never
 * touched opens for the page they are on, and otherwise folds as its role's
 * default says.
 */

/** A saved choice per group: true folded, false open. A group with no entry was never touched. */
export type FoldChoices = Record<string, boolean>;

export function isGroupOpen(choice: boolean | undefined, foldedByDefault: boolean, onOneOfItsPages: boolean): boolean {
  if (choice !== undefined) return !choice;
  return !foldedByDefault || onOneOfItsPages;
}

/** The choices after a click on a group's header: it folds when shown open and opens when shown folded. */
export function toggleFold(choices: FoldChoices, id: string, shownOpen: boolean): FoldChoices {
  return { ...choices, [id]: shownOpen };
}
