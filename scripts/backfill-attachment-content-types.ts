/**
 * Re-upload captured email attachments under their real content type.
 *
 * The autopilot used to store every attachment as application/octet-stream,
 * which Storage serves back verbatim — so the reviewer's "Preview" silently
 * became a download. The upload path is fixed; this repairs what it already
 * wrote.
 *
 * Setting storage.objects.metadata in SQL does NOT work: the served header
 * comes from the stored object, not the database row. The bytes have to be
 * re-uploaded.
 *
 * Usage:
 *   npx tsx scripts/backfill-attachment-content-types.ts --dry-run
 *   npx tsx scripts/backfill-attachment-content-types.ts
 */

import { readFileSync } from 'fs';

const envContent = readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { getSupabase } = await import('../lib/supabase');
  const { contentTypeFor, FALLBACK_CONTENT_TYPE } = await import('../lib/mime');
  const db = getSupabase();

  const { data: attachments, error } = await db
    .from('email_attachments')
    .select('id, file_name, content_type, storage_path')
    .not('storage_path', 'is', null);

  if (error) throw new Error(`Query failed: ${error.message}`);

  const rows = (attachments ?? []) as Array<{
    id: number;
    file_name: string;
    content_type: string | null;
    storage_path: string;
  }>;

  console.log(`${rows.length} rehosted attachment(s) to check.\n`);

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const att of rows) {
    const desired = contentTypeFor(att.file_name, att.content_type);

    if (desired === FALLBACK_CONTENT_TYPE) {
      // Nothing better to say about it than what's already stored.
      skipped++;
      continue;
    }

    const { data: blob, error: dlError } = await db.storage.from('files').download(att.storage_path);
    if (dlError || !blob) {
      console.error(`  FAIL ${att.file_name}: download — ${dlError?.message ?? 'no body'}`);
      failed++;
      continue;
    }

    if (blob.type === desired) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  would fix ${att.file_name}: ${blob.type || 'unknown'} → ${desired}`);
      fixed++;
      continue;
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const { error: upError } = await db.storage
      .from('files')
      .upload(att.storage_path, buffer, { upsert: true, contentType: desired });

    if (upError) {
      console.error(`  FAIL ${att.file_name}: upload — ${upError.message}`);
      failed++;
      continue;
    }

    console.log(`  fixed ${att.file_name} → ${desired}`);
    fixed++;
  }

  console.log(
    `\n${dryRun ? '[dry run] ' : ''}${fixed} fixed, ${skipped} already correct or untypable, ${failed} failed.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
