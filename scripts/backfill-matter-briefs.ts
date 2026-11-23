/**
 * Backfill maintained matter briefs for every matter.
 * Skips matters whose brief is already at the current version.
 *
 * Usage:
 *   npx tsx scripts/backfill-matter-briefs.ts                # all matters
 *   npx tsx scripts/backfill-matter-briefs.ts --only-missing # only matters without a brief
 *   npx tsx scripts/backfill-matter-briefs.ts --limit 5      # cap run count
 *   npx tsx scripts/backfill-matter-briefs.ts --matter-id x  # just one
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
import { generateEmbeddingsForMatterSummary } from '../lib/ai/embeddings';

const THROTTLE_MS = 500;

const onlyMissing = process.argv.includes('--only-missing');
const force = process.argv.includes('--force');
const matterIdArg = process.argv.find((a) => a.startsWith('--matter-id'));
const matterIdTarget = matterIdArg
  ? (matterIdArg.includes('=') ? matterIdArg.split('=')[1] : process.argv[process.argv.indexOf(matterIdArg) + 1])
  : null;
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg
  ? Number(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1])
  : null;

async function main() {
  const supabase = getSupabase();

  let query = supabase
    .from('matters')
    .select('notion_id, name, matter_code, type, status, case_title, case_number, case_description, court, client_name, is_case, firm_id');

  if (matterIdTarget) query = query.eq('notion_id', matterIdTarget);

  const { data: matters, error } = await query;
  if (error) {
    console.error('Failed to list matters:', error.message);
    process.exit(1);
  }

  // Determine which matters to process.
  // A matter is "already current" iff its summary row exists AND has the new
  // structured fields populated (key_dates). Rows from the old generator have
  // a summary but no key_dates, so they need re-running even though the
  // default brief_version=1 says otherwise.
  const { data: existing } = await supabase
    .from('matter_summaries')
    .select('matter_id, key_dates');
  const currentMap = new Map(
    (existing ?? []).map((e) => [e.matter_id, e.key_dates !== null]),
  );

  const targets = (matters ?? []).filter((m) => {
    const hasCurrentBrief = currentMap.get(m.notion_id) ?? false;
    const hasAnyBrief = currentMap.has(m.notion_id);
    if (force) return true;
    if (onlyMissing) return !hasAnyBrief;
    return !hasCurrentBrief;
  });

  const work = LIMIT ? targets.slice(0, LIMIT) : targets;
  console.log(`[brief-backfill] Candidates: ${work.length} matters (of ${matters?.length ?? 0} total). Throttle ${THROTTLE_MS}ms.`);

  let ok = 0, err = 0;
  let inTok = 0, outTok = 0;
  const startedAt = Date.now();

  for (let i = 0; i < work.length; i++) {
    const m = work[i];
    const ctx: MatterContext = {
      notion_id: m.notion_id,
      name: m.name,
      matter_code: m.matter_code,
      type: m.type,
      status: m.status,
      case_title: m.case_title,
      case_number: m.case_number,
      case_description: m.case_description,
      court: m.court,
      client_name: m.client_name,
      is_case: !!m.is_case,
      firmId: m.firm_id,
    };

    try {
      const brief = await generateMatterBrief(ctx);
      inTok += brief.input_tokens;
      outTok += brief.output_tokens;

      await supabase.from('matter_summaries').upsert({
        matter_id: m.notion_id,
        summary: brief.summary,
        latest_incident: brief.latest_incident,
        latest_incident_date: brief.latest_incident_date,
        brief_version: brief.brief_version,
        key_dates: brief.key_dates,
        open_issues: brief.open_issues,
        posture: brief.posture,
        parties: brief.parties,
        claims_and_defenses: brief.claims_and_defenses,
        court_and_venue: brief.court_and_venue,
        key_rulings: brief.key_rulings,
        model_used: brief.model,
        token_count_input: brief.input_tokens,
        token_count_output: brief.output_tokens,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'matter_id' });

      // Fire-and-forget embedding refresh. We don't want a Voyage blip to
      // fail the whole backfill — the next embedding webhook will catch it.
      generateEmbeddingsForMatterSummary(m.notion_id, m.firm_id).catch(() => { /* ignore */ });

      ok++;
      const kind = m.is_case ? 'case' : 'non-case';
      console.log(`  [${i + 1}/${work.length}] ✓ ${kind}: ${m.name} (in=${brief.input_tokens} out=${brief.output_tokens})`);
    } catch (e) {
      err++;
      console.error(`  [${i + 1}/${work.length}] ✗ ${m.name}:`, e instanceof Error ? e.message : e);
    }

    await new Promise((res) => setTimeout(res, THROTTLE_MS));
  }

  const totalS = ((Date.now() - startedAt) / 1000).toFixed(0);
  // Rough cost: haiku 4.5 is $0.25/1M input, $1.25/1M output (confirm current prices).
  const estCost = (inTok / 1_000_000) * 0.25 + (outTok / 1_000_000) * 1.25;
  console.log(`[brief-backfill] Done in ${totalS}s. ok=${ok} err=${err}. tokens in=${inTok} out=${outTok}. Est cost ≈ $${estCost.toFixed(2)}.`);
}

main().catch((err) => {
  console.error('[brief-backfill] Fatal:', err);
  process.exit(1);
});
