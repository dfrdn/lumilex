import type { SupabaseClient } from '@supabase/supabase-js';
import { allocateClientCode } from '@/lib/clients/allocate-client-code';
import { mintId } from '@/lib/ids';
import { logAudit } from '@/lib/audit';

export interface ResolvedClient {
  notionId: string;
  name: string;
  clientCode: number | null;
  /** True when an existing client was reused instead of a new row being inserted. */
  reused: boolean;
}

export interface FindOrCreateOptions {
  /** Prefix for the synthesized `notion_id`, so the minting flow stays legible. */
  idPrefix?: string;
  /**
   * `clients.status` for a newly inserted row. Defaults to `Active`; a
   * pre-incorporation corporation passes `Prospective`, since the company
   * doesn't legally exist yet and shouldn't be counted as an active client.
   */
  status?: string;
  /** Firm the new client belongs to — scopes the code allocator and the audit row. */
  firmId: string;
  /**
   * Who is minting. Required, not optional: these rows are inserted on a
   * person's behalf by a flow they didn't name — a corporation create, an SEC
   * approval — so without an audit row the client has no traceable origin at
   * all, only a `client-corp-*` id and a timestamp to reason from.
   */
  performedBy: string;
  ipAddress?: string;
}

/** Escape the PostgREST `like`/`ilike` metacharacters so `ilike` matches literally. */
function escapePattern(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/**
 * Normalize a name for equality comparison. Mirrors the intent of the
 * `clients_name_unique_ci` index (`lower(btrim(name))`) but trims the full JS
 * whitespace set, so a value the `ilike` pattern over-matched can be rejected.
 */
function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Find a client by name, case-insensitively and whitespace-trimmed.
 *
 * PostgREST rewrites `*` to `%` inside `ilike` patterns with no escape hatch, so
 * a name like `"*"` would otherwise match every client and bind a corporation to
 * an unrelated one. The `ilike` filter is only a coarse prefilter — the caller's
 * name is confirmed against each candidate with an exact normalized-equality
 * check in JS before any row is treated as an existing client.
 */
export async function findClientByName(
  supabase: SupabaseClient,
  rawName: string,
): Promise<ResolvedClient | null> {
  const name = rawName.trim();
  if (!name) return null;
  const target = normalizeName(name);

  const { data, error } = await supabase
    .from('clients')
    .select('notion_id, name, client_code')
    .ilike('name', escapePattern(name))
    .limit(10);

  // A swallowed read error would masquerade as "no client owns this name" and
  // trigger a spurious insert (or a phantom-clear of a rename collision check).
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { notion_id: string; name: string; client_code: number | null }[];
  const match = rows.find((r) => normalizeName(r.name) === target);
  if (!match) return null;
  return { notionId: match.notion_id, name: match.name, clientCode: match.client_code, reused: true };
}

/**
 * Minting a client under a name another client already answers to would fork a
 * second row sharing it, and every table that denormalizes `client_name` would
 * stop being able to tell the two apart. Whether the new record is that client
 * or a genuinely different company is a judgment call, so the staff-facing
 * creation paths hand this back rather than guessing.
 *
 * Worded without a closing verb so it reads the same whether the caller was
 * converting a public submission or adding a prospect by hand.
 */
export function nameTakenMessage(clientName: string): string {
  return (
    `A client named "${clientName}" already exists. Link this to that client, ` +
    'or give it a distinguishing name.'
  );
}

/**
 * Resolve a client name to a client row, inserting one only when no client owns
 * that name yet.
 *
 * `clients.name` is a de-facto foreign key in this schema: ten tables
 * denormalize `client_name` and match on the string
 * ([lib/clients/cascade-rename.ts]), and `dtr_revision_reviews` carries
 * UNIQUE(billing_month, client_name). A second client row sharing a name
 * commingles both clients' DTRs, invoices and billing bundles, so every path
 * that mints a client goes through here rather than inserting blind.
 *
 * `supabase` reads under the caller's RLS; `service` performs the insert — the
 * clients write policy is restricted to privileged roles, and these rows are
 * system-generated.
 */
export async function findOrCreateClientByName(
  supabase: SupabaseClient,
  service: SupabaseClient,
  rawName: string,
  { idPrefix = 'client', status = 'Active', firmId, performedBy, ipAddress }: FindOrCreateOptions,
): Promise<ResolvedClient> {
  const name = rawName.trim();
  if (!name) throw new Error('findOrCreateClientByName: name is required');

  const existing = await findClientByName(supabase, name);
  if (existing) return existing;

  // Allocate through the DB allocator, not `max(client_code) + 1`. The old read
  // ran under the *caller's* RLS, so it could under-count rows the caller can't
  // see and re-mint a used code — and since 20260730 added
  // `clients_client_code_unique`, that lands as a hard 23505 rather than a quiet
  // duplicate. See lib/clients/allocate-client-code.ts.
  const clientCode = await allocateClientCode(service, firmId);

  const notionId = mintId(idPrefix);

  // Both success paths return through here so a mint can't land unaudited.
  function minted(code: number): ResolvedClient {
    logAudit({
      firmId,
      entityType: 'clients',
      entityId: notionId,
      entityName: name,
      action: 'create',
      performedBy,
      ipAddress,
    });
    return { notionId, name, clientCode: code, reused: false };
  }
  const { error } = await service.from('clients').insert({
    notion_id: notionId,
    name,
    client_code: clientCode,
    full_company_name: name,
    status,
    created_time: new Date().toISOString(),
  });

  if (error) {
    // 23505 = another request created the same name between the read and the
    // insert. Re-read and hand back the winner rather than failing the caller.
    if (error.code === '23505') {
      const raced = await findClientByName(supabase, name);
      if (raced) return raced;

      // Only a *name* collision has a winner to hand back. A `client_code`
      // collision means something that bypassed the allocator already holds the
      // code — the by-name re-read finds nothing and the caller sees a raw 500.
      // allocate_client_code() floors itself at max(client_code), so one retry
      // clears the used code.
      if (error.message.includes('clients_client_code_unique')) {
        const retryCode = await allocateClientCode(service, firmId);
        const { error: retryError } = await service.from('clients').insert({
          notion_id: notionId,
          name,
          client_code: retryCode,
          full_company_name: name,
          status,
          created_time: new Date().toISOString(),
        });
        if (retryError) throw new Error(retryError.message);
        return minted(retryCode);
      }
    }
    throw new Error(error.message);
  }

  return minted(clientCode);
}
