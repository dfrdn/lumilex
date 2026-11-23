/**
 * Fire-and-forget click attribution for knowledge search. Records which result
 * the user opened against the `knowledge_searches` row that produced it.
 *
 * `keepalive` lets the request outlive the navigation the click triggers, so
 * we don't need to preventDefault or delay the link. A no-op when there's no
 * search id (e.g. the search log insert failed) — tracking must never get in
 * the way of opening the result.
 */
export function trackKnowledgeClick(
  searchId: number | null | undefined,
  sourceType: string,
  sourceId: string,
): void {
  if (!searchId) return;
  try {
    void fetch('/api/knowledge/search/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchId, sourceType, sourceId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never let click tracking interfere with navigation
  }
}
