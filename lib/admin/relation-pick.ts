/**
 * Relation pickers show names, and names repeat: "People v. Santos" is two
 * matters. The add form keeps the picked record's id beside its name, sends
 * the ids with the row as `relationIds` (field key → id), and the route
 * resolves by id, falling back to the name for callers that send none.
 */

export interface RelationOption {
  id: string;
  name: string;
}

/** The id of the record a relation field names: the one picked, else the only option of that name. */
export function pickedRelationId(
  options: RelationOption[],
  name: string,
  pickedId?: string | null,
): string | null {
  if (!name) return null;
  if (pickedId) return pickedId;
  const matches = options.filter((o) => o.name === name);
  return matches.length === 1 ? matches[0].id : null;
}

/** The id a POST body's `relationIds` gives for a field, if any. */
export function relationIdFor(relationIds: unknown, key: string): string | null {
  if (!relationIds || typeof relationIds !== 'object' || Array.isArray(relationIds)) return null;
  const id = (relationIds as Record<string, unknown>)[key];
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}
