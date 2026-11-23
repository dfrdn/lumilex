import type { SupabaseClient } from '@supabase/supabase-js';
import { MATTER_TYPE_CODES } from '@/lib/admin/entity-config';
import { fetchMatterTypeCodes } from '@/lib/enum-options';

export interface DeriveMatterCodeArgs {
  /** Preferred: the owning client's `clients.notion_id`. */
  clientId?: string | null;
  /** Fallback when only the denormalized name is on hand. */
  clientName?: string | null;
  /** `matters.type` — resolved to a numeric code via enum_options. */
  type: string;
  /** Exclude a row from the sequence count (re-derivation for an existing matter). */
  excludeNotionId?: string;
}

/**
 * Derive a matter code: `{clientCode}-{typeCode}-{sequence}`.
 *
 * sequence = one past the highest sequence among that client's other matters.
 * Matching by `client_id` is what makes the sequence stable: legacy
 * `client_name` variants (e.g. "Foo" vs "Foo (155)") would otherwise reset it
 * mid-client.
 *
 * Shared by the admin entity routes and the corporation create / SEC-approval
 * chain. Every path that inserts a `matters` row goes through here — a matter
 * with an empty code is invisible to the code column, sorts to null, and can't
 * be matched by subject line.
 *
 * `supabase` is the caller's client: the admin routes pass the authed one, the
 * corporation SEC chain passes service-role (it runs without a JWT context).
 * Note the read is RLS-scoped on an authed client — a caller who can't see all
 * of a client's matters derives a low sequence, which the `clientId` path keeps
 * rare but doesn't eliminate.
 */
export async function deriveMatterCode(
  supabase: SupabaseClient,
  firmId: string,
  { clientId, clientName, type, excludeNotionId }: DeriveMatterCodeArgs,
): Promise<string> {
  let code: number | null = null;
  let id: string | null = clientId ?? null;

  if (id) {
    const { data } = await supabase
      .from('clients')
      .select('client_code')
      .eq('notion_id', id)
      .maybeSingle();
    code = (data?.client_code as number | undefined) ?? null;
  } else if (clientName) {
    const { data } = await supabase
      .from('clients')
      .select('notion_id, client_code')
      .eq('name', clientName)
      .maybeSingle();
    code = (data?.client_code as number | undefined) ?? null;
    id = (data?.notion_id as string | undefined) ?? null;
  }

  const clientCode = code ?? 0;

  // Type code — DB-backed registry, fall back to the hardcoded map if the value
  // isn't seeded or the DB read fails.
  const dbCodes = await fetchMatterTypeCodes(firmId);
  const typeCode = dbCodes[type] ?? MATTER_TYPE_CODES[type] ?? 0;

  let query = supabase.from('matters').select('matter_code');
  query = id ? query.eq('client_id', id) : query.eq('client_name', clientName ?? '');
  if (excludeNotionId) query = query.neq('notion_id', excludeNotionId);
  const { data: siblings } = await query;

  return `${clientCode}-${typeCode}-${nextSequence(siblings ?? [])}`;
}

/**
 * One past the highest sequence the client already uses, 0 for its first
 * matter. A count of rows would reuse a taken number after a matter is deleted
 * or moved to another client.
 */
export function nextSequence(siblings: { matter_code: string | null }[]): number {
  let max = -1;
  for (const { matter_code } of siblings) {
    const seq = Number(matter_code?.match(/^\d+-\d+-(\d+)$/)?.[1]);
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return max + 1;
}
