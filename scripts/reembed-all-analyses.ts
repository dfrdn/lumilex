/**
 * Re-embed every completed file_analyses row with the updated
 * generateEmbeddingsForFileAnalysis — picks up the flattened `entities` block
 * so RAG retrieval matches on parties/dates/deadlines/obligations/doc type/
 * jurisdiction directly instead of relying on them being restated in prose.
 *
 * Deletes prior embeddings for each analysis first so we don't end up with
 * a mix of old and new chunks.
 *
 * Usage:
 *   npx tsx scripts/reembed-all-analyses.ts            # all completed
 *   npx tsx scripts/reembed-all-analyses.ts --limit 50 # cap count
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

const argLimit = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = argLimit ? Number(argLimit.split('=')[1] ?? process.argv[process.argv.indexOf(argLimit) + 1]) : null;
const THROTTLE_MS = 250; // Voyage rate limiting

async function main() {
  const supabase = getSupabase();

  // Page through all completed analyses.
  const pageSize = 500;
  let from = 0;
  const allRows: { id: number; firm_id: string }[] = [];
  while (true) {
    const { data, error } = await supabase
      .from('file_analyses')
      .select('id, firm_id')
      .eq('status', 'completed')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      console.error('Failed to page analyses:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const r of data) allRows.push({ id: r.id, firm_id: r.firm_id });
    if (data.length < pageSize) break;
    from += pageSize;
    if (LIMIT && allRows.length >= LIMIT) break;
  }

  const target = LIMIT ? allRows.slice(0, LIMIT) : allRows;
  console.log(`[reembed-all] Re-embedding ${target.length} completed analyses (throttle=${THROTTLE_MS}ms)…`);

  let ok = 0, err = 0, emptyN = 0;
  const startedAt = Date.now();

  for (let i = 0; i < target.length; i++) {
    const { id, firm_id: firmId } = target[i];
    try {
      // Wipe prior embedding rows for this analysis so the re-embed replaces
      // cleanly instead of stacking old + new chunks.
      await supabase
        .from('embeddings')
        .delete()
        .eq('source_id', String(id))
        .in('source_type', ['file_analysis', 'deliverable_version']);

      const n = await generateEmbeddingsForFileAnalysis(id, firmId);
      if (n === 0) emptyN++;
      else ok++;

      if ((i + 1) % 25 === 0 || i === target.length - 1) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`  [${i + 1}/${target.length}] ok=${ok} empty=${emptyN} err=${err} elapsed=${elapsed}s`);
      }

      await new Promise((res) => setTimeout(res, THROTTLE_MS));
    } catch (e) {
      err++;
      console.error(`  ✗ analysis=${id}:`, e instanceof Error ? e.message : e);
    }
  }

  const totalS = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`[reembed-all] Done. ok=${ok} empty=${emptyN} err=${err} in ${totalS}s`);
}

main().catch((err) => {
  console.error('[reembed-all] Fatal:', err);
  process.exit(1);
});
