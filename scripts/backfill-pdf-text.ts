/**
 * Backfill extracted_text for deliverable-version analyses that have none.
 *
 * The firm drafts in DOCX but FILES a scanned PDF, and the analysis ran on the
 * latest version — usually that scanned PDF, which is an image (Claude Files
 * API read it natively and stored only a summary, no extracted_text). But ~88%
 * of finalized deliverables also have a DOCX version of the SAME document. This
 * pulls text from that DOCX sibling (mammoth, LOCAL, no API cost) and fills the
 * column, so the Drafting Studio's full-exemplar injection + house-style
 * profiles (which read extracted_text) can use the firm's real filings. Truly
 * scanned-only deliverables (no DOCX version) are skipped.
 *
 * Usage: npx tsx scripts/backfill-pdf-text.ts [--dry-run] [--limit=N]
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
import { fetchAndExtract } from '../lib/ai/document-parser';

const DRY_RUN = process.argv.includes('--dry-run');
const THROTTLE_MS = 250;
const MIN_TEXT = 400;
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith('--limit='));
  const n = arg ? Number(arg.split('=')[1]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

type Sb = ReturnType<typeof getSupabase>;

/** Re-mint a working download URL from deliverable_files.file_url. */
async function resolveUrl(sb: Sb, stored: string): Promise<string> {
  if (!stored) return stored;
  const m = stored.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
  if (m) {
    const { data } = await sb.storage.from(decodeURIComponent(m[1])).createSignedUrl(decodeURIComponent(m[2]), 3600);
    return data?.signedUrl ?? stored;
  }
  if (!stored.startsWith('http')) {
    const { data } = await sb.storage.from('files').createSignedUrl(stored, 3600);
    return data?.signedUrl ?? stored;
  }
  return stored;
}

async function main() {
  const sb = getSupabase();

  // Deliverable-version analyses missing usable text.
  const { data: rows, error } = await sb
    .from('file_analyses')
    .select('id, deliverable_file_id, attachment_name, extracted_text')
    .not('deliverable_file_id', 'is', null)
    .eq('status', 'completed');
  if (error) { console.error('Query failed:', error.message); process.exit(1); }

  const candidates = (rows ?? []).filter(
    (r) => !r.extracted_text || r.extracted_text.trim().length < MIN_TEXT,
  );
  const total = candidates.length;
  if (LIMIT && candidates.length > LIMIT) candidates.length = LIMIT;

  console.log(`[pdf-text] ${total} analyses missing text; processing ${candidates.length}${DRY_RUN ? ' (dry run)' : ''}.`);
  if (DRY_RUN) return;

  let filled = 0, skipped = 0, errors = 0;

  for (const r of candidates) {
    try {
      // The analyzed version (often a scanned PDF). Find a DOCX version of the
      // SAME deliverable to source real text from.
      const { data: analyzedDf } = await sb
        .from('deliverable_files')
        .select('deliverable_id')
        .eq('id', r.deliverable_file_id!)
        .maybeSingle();
      if (!analyzedDf?.deliverable_id) { skipped++; continue; }

      const { data: docxDf } = await sb
        .from('deliverable_files')
        .select('file_url, file_name')
        .eq('deliverable_id', analyzedDf.deliverable_id)
        .ilike('file_name', '%.docx')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!docxDf?.file_url) {
        skipped++;
        console.log(`  – ${r.attachment_name}: no DOCX version (scanned-only)`);
        continue;
      }

      const url = await resolveUrl(sb, docxDf.file_url);
      const extracted = await fetchAndExtract(url);
      const text = extracted.text?.trim() ?? '';
      if (text.length < MIN_TEXT) {
        skipped++;
        console.log(`  – ${r.attachment_name}: DOCX yielded no text (${text.length} chars)`);
        continue;
      }

      const { error: upErr } = await sb
        .from('file_analyses')
        .update({ extracted_text: text })
        .eq('id', r.id);
      if (upErr) { errors++; console.error(`  ✗ ${r.attachment_name}: ${upErr.message}`); continue; }
      filled++;
      console.log(`  ✓ ${r.attachment_name}: ${text.length} chars`);
      await new Promise((res) => setTimeout(res, THROTTLE_MS));
    } catch (err) {
      errors++;
      console.error(`  ✗ analysis ${r.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[pdf-text] Done. filled=${filled} skipped=${skipped} errors=${errors} of ${candidates.length}`);
}

main().catch((err) => {
  console.error('[pdf-text] Fatal:', err);
  process.exit(1);
});
