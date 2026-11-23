/**
 * Re-analyze file_analyses rows whose `entities` JSON predates the current
 * shape (no `parties` field) so the document analysis UI can render them.
 *
 * Re-uses the production analysis pipeline (processAnalysisBackground) so
 * results match what new analyses produce today.
 *
 * Usage:
 *   npx tsx scripts/reanalyze-legacy-entities.ts            # all
 *   npx tsx scripts/reanalyze-legacy-entities.ts --limit 10
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
import { processAnalysisBackground } from '../lib/ai/auto-analyze';

const argLimit = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = argLimit
  ? Number(argLimit.split('=')[1] ?? process.argv[process.argv.indexOf(argLimit) + 1])
  : null;
const THROTTLE_MS = 1000;

type LegacyRow = {
  id: number;
  file_id: string;
  attachment_name: string;
  attachment_url: string | null;
  firm_id: string;
};

type FileAttachment = { name: string; url: string; path?: string };

async function main() {
  const supabase = getSupabase();

  console.log('Loading legacy file_analyses rows…');
  let query = supabase
    .from('file_analyses')
    .select('id, file_id, attachment_name, attachment_url, entities, firm_id')
    .eq('status', 'completed')
    .order('id', { ascending: true });

  const { data, error } = await query;
  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  const legacy: LegacyRow[] = (data ?? [])
    .filter((r) => r.entities && !Object.prototype.hasOwnProperty.call(r.entities, 'parties'))
    .map((r) => ({
      id: r.id,
      file_id: r.file_id,
      attachment_name: r.attachment_name,
      attachment_url: r.attachment_url,
      firm_id: r.firm_id,
    }));

  const targets = LIMIT ? legacy.slice(0, LIMIT) : legacy;
  console.log(`Found ${legacy.length} legacy rows; processing ${targets.length}.`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const progress = `[${i + 1}/${targets.length}]`;

    const { data: file } = await supabase
      .from('files')
      .select('name, matter_name, file_urls')
      .eq('notion_id', row.file_id)
      .maybeSingle();

    if (!file) {
      console.warn(`${progress} ✗ ${row.attachment_name} — parent file ${row.file_id} not found`);
      skipped++;
      continue;
    }

    const fileUrls: FileAttachment[] =
      typeof file.file_urls === 'string' ? JSON.parse(file.file_urls) : (file.file_urls ?? []);
    const attachment = fileUrls.find((a) => a.name === row.attachment_name);

    let url: string | null = null;
    if (attachment?.path) {
      const { data: signed } = await supabase.storage
        .from('files')
        .createSignedUrl(attachment.path, 60 * 60);
      url = signed?.signedUrl ?? null;
    } else if (attachment?.url) {
      url = attachment.url;
    } else if (row.attachment_url) {
      url = row.attachment_url;
    }

    if (!url) {
      console.warn(`${progress} ✗ ${row.attachment_name} — no resolvable URL`);
      skipped++;
      continue;
    }

    // Clear the stale claude_file_id so we don't try to reuse an expired upload.
    await supabase
      .from('file_analyses')
      .update({ claude_file_id: null })
      .eq('id', row.id);

    try {
      await processAnalysisBackground(
        row.id,
        row.file_id,
        { name: row.attachment_name, url },
        file.name || row.attachment_name,
        file.matter_name || '',
        row.firm_id,
      );
      ok++;
      console.log(`${progress} ✓ ${file.name} / ${row.attachment_name}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${progress} ✗ ${row.attachment_name}: ${msg}`);
    }

    if (i + 1 < targets.length) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  }

  console.log(`\nDone. ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
