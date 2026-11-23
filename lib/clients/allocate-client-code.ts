import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Allocate the next `clients.client_code` for a firm atomically via the DB
 * allocator.
 *
 * `allocate_client_code(p_firm_id)` serializes concurrent callers on the
 * firm's counter row and floors the result at the firm's current max, so two
 * simultaneous client creates — even with different names — can never mint
 * the same code. This replaces the old `max(client_code) + 1` read, which ran
 * outside any lock and let concurrent inserts collide (and then propagate the
 * duplicate into matter codes and trademark Ref. Nos.).
 *
 * The RPC is SECURITY DEFINER and firm-guarded: non-service callers must
 * belong to the firm they allocate for.
 */
export async function allocateClientCode(
  supabase: SupabaseClient,
  firmId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('allocate_client_code', { p_firm_id: firmId });
  if (error) throw new Error(`allocate_client_code failed: ${error.message}`);
  return Number(data);
}
