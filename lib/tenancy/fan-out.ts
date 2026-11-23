import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { resolveFeature, type FeatureKey, type FeatureReason } from '@/lib/firm/features';
import { getServiceDbForFirm } from './service-db';

export type ActiveFirm = { id: string; slug: string; name: string; status: string };

export type FirmRunResult<T> = {
  firmId: string;
  slug: string;
  ok: boolean;
  result?: T;
  error?: string;
  /**
   * Set instead of `result` when the firm was skipped because the feature is
   * off for it. A skipped firm stays in the array: an absent firm and a firm
   * that did nothing are indistinguishable from the outside, and that is
   * exactly the confusion that hid two silently-broken crons before.
   */
  skipped?: FeatureReason;
};

/**
 * Runs `fn` once per active firm with a firm-scoped service client.
 * Sequential on purpose — the callers are crons, and fanning a batch job out
 * with Promise.all would multiply its load spike by the number of firms.
 * A per-firm failure is captured in that firm's result; the loop continues.
 *
 * Pass `feature` (or use {@link forEachFirmWithFeature}) to skip firms that
 * don't have it. Skipped firms stay in the results with a `skipped` reason.
 */
export async function forEachActiveFirm<T>(
  fn: (ctx: { firm: ActiveFirm; db: SupabaseClient }) => Promise<T>,
  client: SupabaseClient = getSupabase(),
  feature?: FeatureKey,
): Promise<FirmRunResult<T>[]> {
  const { data, error } = await client
    .from('firms')
    .select('id, slug, name, status')
    .eq('status', 'active')
    .order('slug');
  if (error) throw new Error(`forEachActiveFirm: loading firms failed: ${error.message}`);

  const results: FirmRunResult<T>[] = [];
  for (const firm of (data ?? []) as ActiveFirm[]) {
    try {
      if (feature) {
        const state = await resolveFeature(firm.id, feature);
        if (!state.available) {
          results.push({ firmId: firm.id, slug: firm.slug, ok: true, skipped: state.reason });
          continue;
        }
      }
      const result = await fn({ firm, db: getServiceDbForFirm(firm.id, client) });
      results.push({ firmId: firm.id, slug: firm.slug, ok: true, result });
    } catch (err) {
      results.push({
        firmId: firm.id,
        slug: firm.slug,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/**
 * Fan out only to the firms that have `feature` available, recording the rest
 * as skipped. Same contract as {@link forEachActiveFirm} otherwise.
 *
 * The guard runs here rather than inside each handler so a cron cannot forget
 * it, and so the reason a firm did nothing is visible in the response.
 */
export async function forEachFirmWithFeature<T>(
  feature: FeatureKey,
  fn: (ctx: { firm: ActiveFirm; db: SupabaseClient }) => Promise<T>,
  client: SupabaseClient = getSupabase(),
): Promise<FirmRunResult<T>[]> {
  return forEachActiveFirm(fn, client, feature);
}
