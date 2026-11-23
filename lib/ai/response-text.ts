/**
 * The text of a Claude response. A model that thinks by default puts a
 * `thinking` block ahead of the answer — its text empty unless display is
 * requested — so `content[0]` is not the answer. Joins every
 * text block and throws when there are none, naming the stop reason and block
 * types so a refusal or a thinking-only turn is diagnosable from the error.
 */
export function responseText(response: {
  content: ReadonlyArray<{ type: string }>;
  stop_reason: string | null;
}): string {
  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  if (!text.trim()) {
    throw new Error(`No text in the response from Claude (stop_reason=${response.stop_reason}, blocks=${response.content.map((b) => b.type).join(',') || 'none'})`);
  }
  return text;
}
