/**
 * Backfill the firm-wide Knowledge Base from the matter archive.
 * Runs the same orchestrator as POST /api/kb/backfill, but without the
 * serverless time limit — use this for the full archive.
 *
 * Usage:
 *   NODE_OPTIONS=--experimental-websocket npx tsx scripts/backfill-kb.ts                 # closed matters, min 2 contributors
 *   NODE_OPTIONS=--experimental-websocket npx tsx scripts/backfill-kb.ts --limit 20      # cap matters
 *   NODE_OPTIONS=--experimental-websocket npx tsx scripts/backfill-kb.ts --min 1         # lower contributor threshold
 *   NODE_OPTIONS=--experimental-websocket npx tsx scripts/backfill-kb.ts --matter <id>   # one matter
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
import { runKbBackfill, type KbBackfillScope } from '../lib/ai/kb-backfill';

async function resolveFirmId(requested: string | null): Promise<string> {
  const { data: firms } = await getSupabase()
    .from('firms')
    .select('id, slug, status')
    .eq('status', 'active')
    .order('slug');
  const list = (firms ?? []) as { id: string; slug: string }[];
  if (list.length === 0) throw new Error('No active firms.');

  if (requested) {
    const hit = list.find((f) => f.id === requested || f.slug === requested);
    if (!hit) {
      throw new Error(`No active firm matching "${requested}". Active: ${list.map((f) => f.slug).join(', ')}`);
    }
    return hit.id;
  }

  if (list.length > 1) {
    throw new Error(`Several active firms — pass --firm <slug>: ${list.map((f) => f.slug).join(', ')}`);
  }
  console.log(`Firm: ${list[0].slug} (${list[0].id})`);
  return list[0].id;
}


function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const firmId = await resolveFirmId(arg('--firm') ?? null);
  const scope: KbBackfillScope = {
    limit: arg('--limit') ? Number(arg('--limit')) : null,
    minContributors: arg('--min') ? Number(arg('--min')) : 2,
    matterIds: arg('--matter') ? [arg('--matter')!] : undefined,
  };

  console.log('Starting KB backfill with scope:', JSON.stringify(scope));
  const { jobId, stats } = await runKbBackfill(firmId, scope, 'script');
  console.log(`\nJob #${jobId} complete:`);
  console.log(`  matters processed:   ${stats.mattersProcessed}`);
  console.log(`  signals extracted:   ${stats.signalsExtracted}`);
  console.log(`  pages written:       ${stats.pagesWritten}`);
  console.log(`  by kind:             ${JSON.stringify(stats.pagesByKind)}`);
  console.log(`  skipped (<threshold):${stats.skippedBelowThreshold}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
