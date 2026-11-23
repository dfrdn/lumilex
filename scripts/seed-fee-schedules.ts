import './load-env';
import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { SEED_FEE_SCHEDULES } from '../lib/provisioning/seed-pack/fee-schedules';

/**
 * Seed one firm's fee schedules from the seed pack.
 *
 *   npx tsx scripts/seed-fee-schedules.ts <firmId>
 *
 * scripts/provision-firm.ts already does this for a new firm; this script is
 * for a firm that predates it — the dev firm, or any tenant onboarded before
 * the seed pack existed.
 *
 * It matters because `loadFeeSchedules()` no longer has an in-code fallback:
 * lib/fee-schedule/default.ts held one real firm's 2026 rate card and was
 * served to any firm that had saved nothing, so an unseeded tenant quoted
 * another firm's prices as its own. The loader now throws instead, and a firm
 * with no rows can publish nothing until it has some.
 *
 * The seeded schedules carry structure and no figures — every tier is unpriced
 * and `pricedTiers()` returns nothing, so nothing here can be quoted before the
 * firm sets its own rates under Admin → Fee schedules. Existing rows are left
 * alone: a firm that has priced a schedule keeps its prices.
 */

async function main() {
  const [firmId] = process.argv.slice(2);
  if (!firmId) {
    console.error('Usage: npx tsx scripts/seed-fee-schedules.ts <firmId>');
    process.exit(1);
  }

  const raw = getSupabase();
  const { data: firm } = await raw.from('firms').select('name').eq('id', firmId).maybeSingle();
  if (!firm) {
    console.error(`No firm with id ${firmId}.`);
    process.exit(1);
  }

  const supabase = getServiceDbForFirm(firmId, raw);
  const { data: existingRows } = await supabase.from('fee_schedules').select('slug');
  const existing = new Set((existingRows ?? []).map((r) => r.slug as string));

  const missing = SEED_FEE_SCHEDULES.filter((s) => !existing.has(s.slug));
  if (missing.length === 0) {
    console.log(`[seed] ${firm.name}: all ${SEED_FEE_SCHEDULES.length} fee schedules present`);
    return;
  }

  const { error } = await supabase.from('fee_schedules').insert(
    missing.map((s) => ({
      slug: s.slug,
      name: s.name,
      content: s.content,
      is_active: s.is_active,
      sort_order: s.sort_order,
      created_by: 'seed-fee-schedules',
    })),
  );
  if (error) {
    console.error('[seed] insert failed', error);
    process.exit(1);
  }

  console.log(
    `[seed] ${firm.name}: inserted ${missing.length} of ${SEED_FEE_SCHEDULES.length} fee schedules (unpriced)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
