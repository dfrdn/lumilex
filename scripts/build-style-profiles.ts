/**
 * Build the Drafting Studio's house-style profiles from the firm's finalized
 * filings. One profile per document type, distilled by an LLM and upserted into
 * drafting_style_profiles. Run after backfill-deliverable-versions has populated
 * analyses (the profiles distil from file_analyses.extracted_text).
 *
 * Usage: npx tsx scripts/build-style-profiles.ts [--only="Position Paper"] [--firm <slug|uuid>]
 * With exactly one active firm the `--firm` flag can be omitted.
 * (needs Node >= 22 for supabase-js websocket; run `nvm use 22` first)
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
import { buildStyleProfile } from '../lib/ai/style-profile';

/**
 * Resolve the firm to build for: `--firm <slug|uuid>`, else the only active
 * firm. With several active firms and no flag, refuse rather than guess.
 */
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

// The document types worth a profile — the studio's common docs plus the firm's
// high-volume finalized types. buildStyleProfile skips any with too few samples.
const DOC_TYPES = [
  'Position Paper',
  'Comment/Opposition',
  'Motion for Reconsideration',
  'Judicial Affidavit',
  'Answer',
  'Petition for Review',
  'Manifestation',
  'Reply',
  'Entry of Appearance',
  'Demand Letter',
  'Status Report',
];

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].replace(/^["']|["']$/g, '') : null;
  const types = only ? [only] : DOC_TYPES;

  const firmFlagIdx = process.argv.indexOf('--firm');
  const firmId = await resolveFirmId(firmFlagIdx !== -1 ? (process.argv[firmFlagIdx + 1] ?? null) : null);

  console.log(`[style-profiles] Building ${types.length} profile(s)…`);
  let built = 0, skipped = 0, errors = 0;

  for (const t of types) {
    try {
      const r = await buildStyleProfile(t, { firmId });
      if (r.skipped) {
        skipped++;
        console.log(`  – ${t}: skipped (${r.skipped})`);
      } else {
        built++;
        console.log(`  ✓ ${t}: distilled from ${r.sampleCount} sample(s)`);
      }
      await new Promise((res) => setTimeout(res, 500));
    } catch (err) {
      errors++;
      console.error(`  ✗ ${t}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[style-profiles] Done. built=${built} skipped=${skipped} errors=${errors}`);
}

main().catch((err) => {
  console.error('[style-profiles] Fatal:', err);
  process.exit(1);
});
