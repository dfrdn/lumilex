/**
 * Mint a primary key for an app-created row in the legacy text-PK tables
 * (`notion_id` columns). Notion-era rows hold Notion page UUIDs; rows minted
 * before this helper existed hold `temp-<entity>-<Date.now()>` strings, which
 * collide at second granularity. The entity prefix keeps provenance readable;
 * the UUID guarantees uniqueness. Works in both server and browser runtimes.
 */
export function mintId(entity: string): string {
  return `${entity}-${globalThis.crypto.randomUUID()}`;
}
