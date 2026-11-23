import { DEMO_AI_LIMITS, assertDemoProject, assertMarkedDemo, findDemoFirm } from './common';
import { getSupabase } from '../../lib/supabase';

/**
 * Put the public demo's AI ceiling on (`settings.aiLimits`), or take it off
 * for a one-time AI pass:
 *
 *   npx tsx scripts/demo/cap-ai.ts          # on: DEMO_AI_LIMITS
 *   npx tsx scripts/demo/cap-ai.ts --off    # off, while filling the snapshot
 *
 * The ceiling is on the firm, not the snapshot: firms is a global table and
 * the nightly reset never touches it, so it stays as set here.
 */

const db = getSupabase();

async function main() {
  assertDemoProject();
  const firm = await findDemoFirm(db);
  if (!firm) throw new Error('No demo firm — run scripts/demo/build.ts first.');
  assertMarkedDemo(firm);

  const aiLimits = process.argv.includes('--off') ? null : DEMO_AI_LIMITS;
  const { error } = await db
    .from('firms')
    .update({ settings: { ...firm.settings, aiLimits } })
    .eq('id', firm.id);
  if (error) throw new Error(`firms.settings write: ${error.message}`);

  console.log(
    aiLimits
      ? `AI ceiling on: ${aiLimits.perHour}/hour, ${aiLimits.perDay}/day (Manila)`
      : 'AI ceiling off — put it back on before visitors arrive.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
