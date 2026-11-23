/**
 * Removes the retired spreadsheet breakdowns from storage. Invoices stopped
 * generating an .xlsx alongside the letter + breakdown PDF; the objects already
 * written are dead weight in the `files` bucket.
 *
 * Usage:
 *   npx tsx scripts/cleanup-invoice-xlsx.ts          # dry run — lists what would go
 *   npx tsx scripts/cleanup-invoice-xlsx.ts --apply  # delete the objects, clear the column
 *
 * Only ever touches paths recorded in `invoices.xlsx_storage_path`, and clears
 * that column for every path it deletes.
 */

import { readFileSync } from 'fs';

// Load .env.local
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

import { getSupabase } from '../lib/supabase';

const apply = process.argv.includes('--apply');

async function main() {
  const supabase = getSupabase();

  const { data: rows, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, xlsx_storage_path')
    .not('xlsx_storage_path', 'is', null)
    .order('id', { ascending: true });

  if (error) throw new Error(error.message);
  const invoices = (rows ?? []) as Array<{ id: number; invoice_number: string; xlsx_storage_path: string }>;

  if (invoices.length === 0) {
    console.log('No invoice spreadsheets left to clean up.');
    return;
  }

  console.log(`${invoices.length} invoice spreadsheet(s) recorded:`);
  for (const inv of invoices) console.log(`  ${inv.invoice_number}  ${inv.xlsx_storage_path}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete these objects and clear the column.');
    return;
  }

  // Storage remove() takes up to 1000 paths per call.
  const paths = invoices.map((i) => i.xlsx_storage_path);
  for (let i = 0; i < paths.length; i += 500) {
    const batch = paths.slice(i, i + 500);
    const { error: rmErr } = await supabase.storage.from('files').remove(batch);
    if (rmErr) throw new Error(`Storage delete failed: ${rmErr.message}`);
    console.log(`Deleted ${batch.length} object(s).`);
  }

  const { error: updErr } = await supabase
    .from('invoices')
    .update({ xlsx_storage_path: null })
    .in('id', invoices.map((i) => i.id));
  if (updErr) throw new Error(`Failed to clear xlsx_storage_path: ${updErr.message}`);

  console.log(`Cleared xlsx_storage_path on ${invoices.length} invoice(s). Done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
