import type { SupabaseClient } from '@supabase/supabase-js';

/** `code` on the 409 a rename endpoint returns when the rename needs confirming. */
export const CLIENT_RENAME_CONFIRM = 'client_rename_confirm';

export interface ClientIdentityLinks {
  /** Active portal users, by name (email when unnamed). */
  portalUsers: string[];
  /** Engagement proposals out with the client: sent or accepted. */
  proposals: number;
}

/**
 * The people who have been told they are this client. Everything is keyed by
 * `client_id`, so a rename keeps them on the record: relabelling one client as
 * another hands the new client's matters to the old client's portal login.
 *
 * Takes the firm-scoped service client: `client_users` is readable only by its
 * own portal user.
 */
export async function clientIdentityLinks(service: SupabaseClient, clientId: string): Promise<ClientIdentityLinks> {
  const [users, proposals] = await Promise.all([
    service
      .from('client_users')
      .select('name, email')
      .eq('client_id', clientId)
      .eq('active', true)
      .order('created_at'),
    service
      .from('engagement_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .in('status', ['sent', 'accepted']),
  ]);
  if (users.error) throw new Error(`portal users lookup failed: ${users.error.message}`);
  if (proposals.error) throw new Error(`proposals lookup failed: ${proposals.error.message}`);
  return {
    portalUsers: (users.data ?? []).map((u) => (u.name as string | null)?.trim() || (u.email as string)),
    proposals: proposals.count ?? 0,
  };
}

/** Case, spacing, and punctuation don't change who the client is. */
export function isCosmeticRename(from: string, to: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return key(from) === key(to);
}

function joinNames(names: string[]): string {
  if (names.length <= 3) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/** The confirmation to show before renaming a client to `to`, or null when nothing is attached. */
export function renameConfirmMessage(to: string, { portalUsers, proposals }: ClientIdentityLinks): string | null {
  const facts: string[] = [];
  if (portalUsers.length) {
    facts.push(`${joinNames(portalUsers)} ${portalUsers.length === 1 ? 'signs' : 'sign'} in to the client portal as this client`);
  }
  if (proposals) {
    facts.push(`${proposals} engagement proposal${proposals === 1 ? ' was' : 's were'} sent under its current name`);
  }
  if (!facts.length) return null;
  const first = facts.join(', and ');
  return `${first[0].toUpperCase()}${first.slice(1)}. Renaming to “${to}” keeps all of it on this record. `
    + 'Fix a spelling here; if this is a different client, add a new client instead.';
}

/** The warning a rename from `from` to `to` needs before it goes ahead, or null. */
export async function clientRenameWarning(
  service: SupabaseClient,
  { clientId, from, to }: { clientId: string; from: string | null; to: string },
): Promise<string | null> {
  if (!from || !to || isCosmeticRename(from, to)) return null;
  return renameConfirmMessage(to, await clientIdentityLinks(service, clientId));
}
