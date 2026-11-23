/**
 * Backfill analyses for finalized deliverable versions.
 * Analyzes the latest version of each deliverable in a terminal, "out the door"
 * status — 'Filed or Sent out' (external) or 'Acknowledged' (internal memos) —
 * matching the live finalization trigger (auto-analyze FINALIZED_STATUSES).
 * This is the gold-exemplar corpus the Drafting Studio grounds on.
 *
 * Usage: npx tsx scripts/backfill-deliverable-versions.ts [--dry-run] [--limit=N]
 */

import { readFileSync } from 'fs';

// Load .env.local so the shared lib modules find SUPABASE_URL / keys / ANTHROPIC_API_KEY
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

// Alias NEXT_PUBLIC_SUPABASE_URL → SUPABASE_URL if only the public one is present
if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}

import { getSupabase } from '../lib/supabase';
import { forEachActiveFirm } from '../lib/tenancy/fan-out';
import {
  processDeliverableVersionAnalysis,
  cleanupZombieAnalyses,
} from '../lib/ai/auto-analyze';
import { isSupportedFileType } from '../lib/ai/document-parser';

const DRY_RUN = process.argv.includes('--dry-run');
const THROTTLE_MS = 1000;
const FINALIZED_STATUSES = ['Filed or Sent out', 'Acknowledged'];
// --limit=N caps how many candidates are processed this run (for a validation
// batch before committing to the whole corpus). 0 / absent = no cap.
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith('--limit='));
  const n = arg ? Number(arg.split('=')[1]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

async function main() {
  const supabase = getSupabase();

  await forEachActiveFirm(({ firm }) => cleanupZombieAnalyses(firm.id)).catch(() => { /* best-effort */ });

  console.log(`[df-backfill] Scanning deliverables with status in [${FINALIZED_STATUSES.join(', ')}]…`);

  const { data: filed, error } = await supabase
    .from('deliverables')
    .select('notion_id, name, matter_id, matter_name, firm_id')
    .in('status', FINALIZED_STATUSES);

  if (error) {
    console.error('Failed to list deliverables:', error.message);
    process.exit(1);
  }

  type Candidate = {
    deliverableId: string;
    deliverableName: string | null;
    matterName: string | null;
    deliverableFileId: number;
    fileName: string;
    version: number;
    fileUrl: string;
    firmId: string;
  };
  const candidates: Candidate[] = [];

  for (const d of filed ?? []) {
    const { data: latest } = await supabase
      .from('deliverable_files')
      .select('id, version, file_name, file_url')
      .eq('deliverable_id', d.notion_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) continue;
    if (!isSupportedFileType(latest.file_name)) continue;

    const { data: existing } = await supabase
      .from('file_analyses')
      .select('id, status, error_message')
      .eq('deliverable_file_id', latest.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      if (existing.status !== 'failed') continue;
      const err = existing.error_message ?? '';
      if (err.includes('Unsupported file type')) continue;
      if (err.startsWith('Permanent skip:')) continue;
      // transient — allow retry (will be re-inserted, old row stays as history)
    }

    candidates.push({
      deliverableId: d.notion_id,
      deliverableName: d.name,
      matterName: d.matter_name,
      deliverableFileId: latest.id,
      fileName: latest.file_name,
      version: latest.version,
      fileUrl: latest.file_url,
      firmId: d.firm_id,
    });
  }

  const total = candidates.length;
  if (LIMIT && candidates.length > LIMIT) {
    candidates.length = LIMIT;
    console.log(`[df-backfill] Found ${total} candidate version(s); capped to ${LIMIT} for this run.`);
  } else {
    console.log(`[df-backfill] Found ${total} candidate version(s):`);
  }
  for (const c of candidates) {
    console.log(`  - ${c.matterName ?? '(no matter)'} / ${c.deliverableName ?? c.deliverableId} v${c.version} → ${c.fileName}`);
  }

  if (DRY_RUN) {
    console.log('[df-backfill] DRY RUN — no work performed.');
    return;
  }

  let processed = 0, errors = 0;

  for (const c of candidates) {
    // Resolve a fresh signed URL for the storage path (the stored file_url may be a path).
    let attachmentUrl = c.fileUrl;
    if (c.fileUrl && !c.fileUrl.startsWith('http')) {
      const { data: signData } = await supabase.storage
        .from('files')
        .createSignedUrl(c.fileUrl, 60 * 60);
      if (signData?.signedUrl) attachmentUrl = signData.signedUrl;
    }

    const { data: row, error: insertErr } = await supabase
      .from('file_analyses')
      .insert({
        firm_id: c.firmId,
        deliverable_file_id: c.deliverableFileId,
        attachment_name: c.fileName,
        attachment_url: attachmentUrl,
        status: 'pending',
        analyzed_by: 'backfill',
      })
      .select('id')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') { console.log(`  [skip] df=${c.deliverableFileId} already enqueued`); continue; }
      errors++;
      console.error(`  [err] df=${c.deliverableFileId}: ${insertErr.message}`);
      continue;
    }

    try {
      await processDeliverableVersionAnalysis(row.id, c.deliverableFileId, c.firmId);
      processed++;
      console.log(`  ✓ ${c.deliverableName} v${c.version}`);
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    } catch (err) {
      errors++;
      console.error(`  ✗ df=${c.deliverableFileId}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[df-backfill] Done. processed=${processed} errors=${errors} candidates=${candidates.length}`);
}

main().catch((err) => {
  console.error('[df-backfill] Fatal:', err);
  process.exit(1);
});
