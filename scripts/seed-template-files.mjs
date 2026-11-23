/**
 * Seed Template Files — Upload DOCX templates to Supabase Storage
 *
 * Run from the project root:
 *   node scripts/seed-template-files.mjs
 *
 * This script:
 * 1. Reads DOCX files from scripts/template-seeds/
 * 2. Uploads them to the 'templates' Supabase Storage bucket
 * 3. Updates the document_templates DB records with the storage paths
 *
 * Prerequisites:
 * - .env.local must contain SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local manually (avoid dotenv dependency)
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const SEEDS_DIR = path.join(__dirname, 'template-seeds');

// Map: DB template ID → DOCX filename in template-seeds/
const TEMPLATE_FILE_MAP = {
  // Existing templates (updated)
  9:  'Engagement_Letter.docx',
  10: 'Non-Disclosure_Agreement.docx',
  11: 'Cover_Letter.docx',
  // New templates (IDs from the insert — adjust if your IDs differ)
  33: 'Authorization_Letter.docx',
  34: 'Client_Advisory_Letter.docx',
  35: 'Reply_to_Demand_Letter.docx',
  36: 'Board_Resolution.docx',
  37: 'Secretarys_Certificate.docx',
  38: 'Special_Power_of_Attorney.docx',
  39: 'Notice_to_Explain.docx',
  40: 'Billing_Statement.docx',
};

async function main() {
  console.log('\n📤 Seeding template DOCX files to Supabase Storage...\n');

  // Ensure the templates bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some(b => b.name === 'templates')) {
    const { error } = await supabase.storage.createBucket('templates', { public: false });
    if (error && !error.message.includes('already exists')) {
      console.error('Failed to create bucket:', error.message);
      process.exit(1);
    }
    console.log('✓ Created "templates" storage bucket\n');
  }

  // First, query the DB to resolve IDs by name (in case IDs differ)
  const { data: templates } = await supabase
    .from('document_templates')
    .select('id, name, generation_mode')
    .eq('generation_mode', 'placeholder')
    .eq('is_active', true);

  const nameToId = {};
  for (const t of templates || []) {
    nameToId[t.name] = t.id;
  }

  // Build dynamic map from names
  const NAME_FILE_MAP = {
    'Engagement Letter': 'Engagement_Letter.docx',
    'Non-Disclosure Agreement': 'Non-Disclosure_Agreement.docx',
    'Cover Letter': 'Cover_Letter.docx',
    'Authorization Letter': 'Authorization_Letter.docx',
    'Client Advisory Letter': 'Client_Advisory_Letter.docx',
    'Reply to Demand Letter': 'Reply_to_Demand_Letter.docx',
    'Board Resolution': 'Board_Resolution.docx',
    "Secretary's Certificate": 'Secretarys_Certificate.docx',
    'Special Power of Attorney': 'Special_Power_of_Attorney.docx',
    'Notice to Explain': 'Notice_to_Explain.docx',
    'Billing Statement': 'Billing_Statement.docx',
  };

  let success = 0;
  let failed = 0;

  for (const [templateName, fileName] of Object.entries(NAME_FILE_MAP)) {
    const id = nameToId[templateName];
    if (!id) {
      console.log(`⚠ Template "${templateName}" not found in DB — skipping`);
      failed++;
      continue;
    }

    const filePath = path.join(SEEDS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠ File "${fileName}" not found in template-seeds/ — skipping`);
      failed++;
      continue;
    }

    const buffer = fs.readFileSync(filePath);
    const storagePath = `${id}/${fileName}`;

    // Remove existing file if any
    await supabase.storage.from('templates').remove([storagePath]);

    // Upload
    const { error: uploadErr } = await supabase.storage
      .from('templates')
      .upload(storagePath, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });

    if (uploadErr) {
      console.log(`✗ ${templateName} (ID ${id}): ${uploadErr.message}`);
      failed++;
      continue;
    }

    // Update DB record
    const { error: dbErr } = await supabase
      .from('document_templates')
      .update({ template_storage_path: storagePath, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (dbErr) {
      console.log(`✗ DB update for "${templateName}": ${dbErr.message}`);
      failed++;
    } else {
      console.log(`✓ ${templateName} (ID ${id}) → ${storagePath} (${(buffer.length / 1024).toFixed(0)} KB)`);
      success++;
    }
  }

  console.log(`\n✅ Done: ${success} uploaded, ${failed} skipped/failed\n`);

  // Print final summary
  const { data: all } = await supabase
    .from('document_templates')
    .select('id, name, category, generation_mode, template_storage_path, is_active')
    .eq('is_active', true)
    .order('id');

  console.log('=== All Active Templates ===\n');
  const categories = {};
  for (const t of all || []) {
    if (!categories[t.category]) categories[t.category] = [];
    categories[t.category].push(t);
  }

  for (const [cat, items] of Object.entries(categories)) {
    console.log(`  ${cat.toUpperCase()} (${items.length})`);
    for (const t of items) {
      const mode = t.generation_mode === 'ai' ? '🤖' : '📋';
      const file = t.generation_mode === 'placeholder'
        ? (t.template_storage_path ? ' ✓' : ' ✗ NEEDS FILE')
        : '';
      console.log(`    ${mode} ${t.id}. ${t.name}${file}`);
    }
    console.log();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
