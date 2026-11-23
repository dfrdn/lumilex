/**
 * Filling and checking firm wording the app lets people edit — the billing
 * letter, the trademark reports. Wording carries `{{field}}` tokens the
 * document fills in, and `[[ … ]]` around words that drop out when a field
 * inside them is blank. Each document has its own set of fields; this is the
 * engine they share. Edit the wording with components/LetterEditor.tsx and
 * convert at its edge with lib/letter-markup.ts.
 */

export const FIELD_RE = /\{\{\s*(\w+)\s*\}\}/g;

/** The fields a wording names. */
export function fieldsIn(body: string): string[] {
  return [...new Set([...body.matchAll(FIELD_RE)].map((m) => m[1]))];
}

/** What is wrong with a wording, if anything, given the fields its document knows. */
export function wordingProblem(body: string, known: ReadonlySet<string>): string | null {
  if (!body.trim()) return 'The paragraph is empty.';
  const unknown = fieldsIn(body).filter((f) => !known.has(f));
  if (unknown.length) return `Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.map((f) => `{{${f}}}`).join(', ')}.`;
  const opens = (body.match(/\[\[/g) ?? []).length;
  const closes = (body.match(/\]\]/g) ?? []).length;
  if (opens !== closes) return 'Every [[ needs a matching ]].';
  return null;
}

/**
 * Fill a wording. A `[[ … ]]` segment drops out when any field in it is blank;
 * outside one, a blank field is just blank.
 */
export function fillWording(body: string, fields: Record<string, string>): string {
  const value = (f: string) => (fields[f] ?? '').trim();
  return body
    .replace(/\[\[([\s\S]*?)\]\]/g, (_, inner: string) => {
      const names = [...inner.matchAll(FIELD_RE)].map((m) => m[1]);
      return names.some((f) => !value(f)) ? '' : inner;
    })
    .replace(FIELD_RE, (_, f: string) => fields[f] ?? '');
}
