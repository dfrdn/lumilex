/**
 * Seed/cleanup for verifying the portal engagement e-signature flow.
 *
 * --seed:    uploads a tiny PDF to the documents bucket and creates a
 *            matter_billing_configs row (litigation) with the engagement
 *            letter attached, on a test matter that has NO config.
 * --cleanup: removes the signature rows, the seeded config row (guarded:
 *            only when it points at the DEV-TEST path), the storage
 *            object, and any engagement_signed notifications.
 *
 * Usage (TEST_MATTER_ID names a test matter on a throwaway instance):
 *   TEST_MATTER_ID=<id> NODE_OPTIONS=--experimental-websocket npx tsx scripts/test-esign-seed.ts --seed
 *   TEST_MATTER_ID=<id> NODE_OPTIONS=--experimental-websocket npx tsx scripts/test-esign-seed.ts --cleanup
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

const TEST_MATTER_ID = process.env.TEST_MATTER_ID ?? '';
if (!TEST_MATTER_ID) throw new Error('set TEST_MATTER_ID to a test matter on a throwaway instance');
const DEV_STORAGE_PATH = 'dev-test/engagement-letter.pdf';
const DEV_FILE_NAME = 'DEV-TEST Engagement Letter.pdf';

const MINI_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n' +
    'trailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF\n',
);

async function main() {
  const arg = process.argv[2] ?? '';
  const supabase = getSupabase();

  if (arg === '--seed') {
    const { data: existing } = await supabase
      .from('matter_billing_configs')
      .select('id, engagement_file_path')
      .eq('matter_id', TEST_MATTER_ID)
      .maybeSingle();
    if (existing) throw new Error('Test matter already has a billing config — aborting to avoid clobbering real data.');

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(DEV_STORAGE_PATH, MINI_PDF, { upsert: true, contentType: 'application/pdf' });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const { error: configError } = await supabase.from('matter_billing_configs').insert({
      matter_id: TEST_MATTER_ID,
      billing_type: 'litigation',
      engagement_file_path: DEV_STORAGE_PATH,
      engagement_file_name: DEV_FILE_NAME,
      engagement_date: '2026-06-11',
    });
    if (configError) throw new Error(`Config insert failed: ${configError.message}`);

    console.log('Seeded engagement letter on the test matter. Remove with --cleanup.');
    return;
  }

  if (arg === '--cleanup') {
    const { data: sigs } = await supabase
      .from('engagement_signatures')
      .delete()
      .eq('matter_id', TEST_MATTER_ID)
      .eq('document_path', DEV_STORAGE_PATH)
      .select('id');

    // Guarded: only delete the config when it is the DEV-TEST one.
    const { data: cfg } = await supabase
      .from('matter_billing_configs')
      .delete()
      .eq('matter_id', TEST_MATTER_ID)
      .eq('engagement_file_path', DEV_STORAGE_PATH)
      .select('id');

    await supabase.storage.from('documents').remove([DEV_STORAGE_PATH]);

    const { data: notifs } = await supabase
      .from('notifications')
      .delete()
      .eq('type', 'engagement_signed')
      .eq('entity_id', TEST_MATTER_ID)
      .select('id');

    console.log(
      `Cleaned up ${sigs?.length ?? 0} signature(s), ${cfg?.length ?? 0} config row(s), storage object, ${notifs?.length ?? 0} notification(s).`,
    );
    return;
  }

  console.log('Pass --seed or --cleanup');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
