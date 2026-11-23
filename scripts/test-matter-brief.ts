/**
 * Smoke-test the matter brief generator on one case + one non-case.
 * Writes results to stdout as pretty JSON so we can eyeball the shape.
 *
 * Usage: npx tsx scripts/test-matter-brief.ts <matterId> [<matterId> ...]
 *        (try one case and one non-case matter)
 */

import { readFileSync } from 'fs';

const envContent = readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}
if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}

import { getSupabase } from '../lib/supabase';
import { generateMatterBrief, type MatterContext } from '../lib/ai/matter-brief';

const IDS = process.argv.slice(2);
if (!IDS.length) throw new Error('usage: test-matter-brief.ts <matterId> [<matterId> ...]');

async function main() {
  const supabase = getSupabase();
  const targets = IDS.map((id) => ({ label: id, id }));

  for (const t of targets) {
    console.log(`\n══════════════════════════════════════════`);
    console.log(`  ${t.label}`);
    console.log(`══════════════════════════════════════════\n`);

    const { data: matter, error } = await supabase
      .from('matters')
      .select('notion_id, name, matter_code, type, status, case_title, case_number, case_description, court, client_name, is_case, firm_id')
      .eq('notion_id', t.id)
      .single();

    if (error || !matter) {
      console.error(`Matter not found: ${t.id}`, error?.message);
      continue;
    }

    const ctx: MatterContext = {
      notion_id: matter.notion_id,
      name: matter.name,
      matter_code: matter.matter_code,
      type: matter.type,
      status: matter.status,
      case_title: matter.case_title,
      case_number: matter.case_number,
      case_description: matter.case_description,
      court: matter.court,
      client_name: matter.client_name,
      is_case: !!matter.is_case,
      firmId: matter.firm_id,
    };

    const startedAt = Date.now();
    try {
      const brief = await generateMatterBrief(ctx);
      const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`(generated in ${elapsedS}s — input=${brief.input_tokens} output=${brief.output_tokens} tokens)\n`);
      console.log(JSON.stringify(brief, null, 2));
    } catch (err) {
      console.error(`Generation failed:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
