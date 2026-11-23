import { DEMO_CONFIG, assertDemoProject, assertMarkedDemo, findDemoFirm } from './common';
import { getSupabase } from '../../lib/supabase';
import { getServiceDbForFirm } from '../../lib/tenancy/service-db';
import { provisionFirm, type ProvisionStep } from '../../lib/provisioning/provision';
import { seedDemoContent } from './content';

/**
 * Build the public demo's fictional firm from nothing:
 *
 *   npx tsx scripts/demo/build.ts
 *
 * 1. Provision it from scripts/demo/firm.json through the same provisionFirm()
 *    every firm goes through — the demo is a firm, configured like one.
 * 2. Mark it the demo (`settings.demo.enabled`) before anything else lands,
 *    so a half-built demo is already one scripts/demo/wipe.ts will agree to
 *    delete. Its AI ceiling is left off here: the one-time AI pass that fills
 *    the golden snapshot would spend it. scripts/demo/cap-ai.ts puts it on.
 * 3. Fill it: staff, clients, matters, work, time, money, documents
 *    (scripts/demo/content.ts). No model is called.
 * 4. Register the personas the one-click sign-in hands out, and switch on the
 *    integrations firm.json entitles it to.
 *
 * The Library handbook, the Rules of Court, the AI pass and the golden
 * snapshot are separate steps; docs/demo-instance.md is the runbook. Refuses
 * to run over a demo that already has content — wipe first.
 */

const db = getSupabase();
const LOCAL_HOST = 'demo.localhost';

function printStep(step: ProvisionStep): void {
  const mark = step.outcome === 'created' ? '+' : step.outcome === 'exists' ? '=' : '·';
  console.log(`  ${mark} ${step.label}${step.detail ? ` — ${step.detail}` : ''}`);
}

async function writeSettings(firmId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await db.from('firms').select('settings').eq('id', firmId).single();
  if (error) throw new Error(`firms read: ${error.message}`);
  const settings = { ...((data.settings ?? {}) as Record<string, unknown>), ...patch };
  const { error: upErr } = await db.from('firms').update({ settings }).eq('id', firmId);
  if (upErr) throw new Error(`firms.settings write: ${upErr.message}`);
}

async function main() {
  assertDemoProject();

  const existing = await findDemoFirm(db);
  if (existing) {
    assertMarkedDemo(existing);
    const { count } = await getServiceDbForFirm(existing.id)
      .from('matters')
      .select('notion_id', { count: 'exact', head: true });
    if ((count ?? 0) > 0) {
      throw new Error('The demo firm already has content. Run scripts/demo/wipe.ts --yes first.');
    }
  }

  console.log(`Provisioning ${DEMO_CONFIG.name} (${DEMO_CONFIG.primaryDomain})`);
  // The first admin's generated password is never printed: every persona,
  // the admin included, signs in through the demo's one-click sign-in.
  const { firmId } = await provisionFirm(DEMO_CONFIG, { db, onStep: printStep });

  await writeSettings(firmId, { demo: { enabled: true, personas: [] } });
  console.log('  + settings.demo enabled');

  // So the demo can be tried, and scripts/demo-probe.ts can run, against a
  // local dev server: http://demo.localhost:3000 resolves to this firm.
  const { data: local } = await db.from('firm_domains').select('firm_id').eq('domain', LOCAL_HOST).maybeSingle();
  if (!local) {
    const { error } = await db.from('firm_domains').insert({ domain: LOCAL_HOST, firm_id: firmId, is_primary: false });
    if (error) throw new Error(`firm_domains ${LOCAL_HOST}: ${error.message}`);
    console.log(`  + firm_domains ${LOCAL_HOST} (secondary, for a local dev server)`);
  } else if (local.firm_id !== firmId) {
    throw new Error(`${LOCAL_HOST} already belongs to firm ${local.firm_id} — refusing to reassign it.`);
  }

  console.log('\nContent');
  const { personas } = await seedDemoContent({ firmId, adminEmail: DEMO_CONFIG.admin.email });

  await writeSettings(firmId, {
    demo: {
      enabled: true,
      personas: Object.entries(personas).map(([key, personId]) => ({ key, personId })),
    },
  });
  console.log(`\n  + ${Object.keys(personas).length} personas registered`);

  const scoped = getServiceDbForFirm(firmId);
  for (const feature of DEMO_CONFIG.features) {
    const { error } = await scoped.from('firm_integrations').update({ enabled: true }).eq('feature', feature);
    if (error) throw new Error(`firm_integrations ${feature}: ${error.message}`);
  }
  console.log(`  + switched on: ${DEMO_CONFIG.features.join(', ')}`);

  console.log(`\nBuilt. firm_id ${firmId}. Next: docs/demo-instance.md → Library, Rules of Court, AI pass, snapshot.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
