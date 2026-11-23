/**
 * Re-embed completed deliverable-version analyses using the updated local code.
 * The DB webhook fired against the deployed (old) endpoint which mislabels these
 * as 'file_analysis' with matter_id=NULL. This script calls generateEmbeddingsForFileAnalysis
 * locally so the correct source_type='deliverable_version' and matter_id get written.
 *
 * Usage: npx tsx scripts/reembed-deliverable-versions.ts
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
import { generateEmbeddingsForFileAnalysis } from '../lib/ai/embeddings';

async function main() {
  const supabase = getSupabase();

  const { data: rows, error } = await supabase
    .from('file_analyses')
    .select('id, firm_id')
    .not('deliverable_file_id', 'is', null)
    .eq('status', 'completed');

  if (error) {
    console.error('Failed to list analyses:', error.message);
    process.exit(1);
  }

  console.log(`[reembed] Re-embedding ${rows?.length ?? 0} deliverable-version analyses…`);

  let ok = 0, err = 0;
  for (const r of rows ?? []) {
    try {
      const n = await generateEmbeddingsForFileAnalysis(r.id, r.firm_id);
      console.log(`  ✓ analysis=${r.id} → ${n} chunks`);
      ok++;
      await new Promise((res) => setTimeout(res, 300)); // throttle Voyage
    } catch (e) {
      console.error(`  ✗ analysis=${r.id}:`, e instanceof Error ? e.message : e);
      err++;
    }
  }

  console.log(`[reembed] Done. ok=${ok} err=${err}`);
}

main().catch((err) => {
  console.error('[reembed] Fatal:', err);
  process.exit(1);
});
