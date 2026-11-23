/**
 * Smoke test: download each registered corporate template, run a sample
 * placeholder substitution, and assert no {{placeholder}} tokens remain
 * (other than ones we intentionally left blank).
 *
 * Run: `npx tsx scripts/smoke-test-corporate-templates.ts`
 */

import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { substituteDocxPlaceholders } from '../lib/docx/placeholder-substitution';

const SAMPLE_VALUES_BY_CATEGORY: Record<string, Record<string, string>> = {
  board_resolution: {
    corporation_name: 'ACME INDUSTRIES, INC.',
    sec_registration_no: 'CS202500123',
    date_of_resolution: '15 May 2026',
    title: 'AUTHORIZING THE OPENING OF A BANK ACCOUNT WITH BPI',
    resolution_body: 'RESOLVED, that the Corporation open and maintain a checking account with BPI, Makati Branch, and that Juan Dela Cruz, in his capacity as President, be hereby authorized to sign all documents necessary therefor.',
    signatory_name: 'Juan Dela Cruz',
    signatory_position: 'President',
  },
  secretarys_certificate: {
    corporation_name: 'ACME INDUSTRIES, INC.',
    sec_registration_no: 'CS202500123',
    secretary_name: 'Maria Santos',
    board_meeting_date: '15 May 2026',
    resolution_quoted_body: 'RESOLVED, that the Corporation open and maintain a checking account with BPI, Makati Branch …',
    date: '20 May 2026',
    notary_block: '',
  },
  minutes_board: {
    corporation_name: 'ACME INDUSTRIES, INC.',
    sec_registration_no: 'CS202500123',
    meeting_date: '15 May 2026',
    meeting_time: '10:00 AM',
    meeting_mode: 'Hybrid',
    venue: '15F Acme Tower, Ayala Avenue, Makati City',
    attendees_block: 'Juan Dela Cruz (President)\nMaria Santos (Corporate Secretary)\nPedro Garcia (Treasurer)\nAna Cruz (Director)\nLuis Reyes (Director)',
    quorum_statement: 'A quorum was duly constituted.',
    agenda_block: '1. Call to order\n2. Approval of minutes of previous meeting\n3. Authorization to open BPI account\n4. Other matters',
    resolutions_block: '1. Authorizing the opening of a bank account with BPI\n2. Designating Juan Dela Cruz as authorized signatory',
    secretary_signature_block: 'Maria Santos',
  },
  minutes_stockholders: {
    corporation_name: 'ACME INDUSTRIES, INC.',
    sec_registration_no: 'CS202500123',
    meeting_date: '15 May 2026',
    venue: '15F Acme Tower, Ayala Avenue, Makati City',
    stockholders_present_block: 'Juan Dela Cruz (50,000 shares)\nMaria Santos (30,000 shares)\nPedro Garcia (20,000 shares)',
    shares_represented: '100,000',
    total_shares_outstanding: '100,000',
    quorum_statement: 'A quorum was duly constituted (100% of shares represented).',
    agenda_block: '1. Call to order\n2. Election of directors\n3. Ratification of board actions\n4. Other matters',
    resolutions_block: '1. Election of directors for the ensuing year\n2. Ratification of all acts of the Board',
    secretary_signature_block: 'Maria Santos',
  },
};

const MULTILINE_KEYS = ['attendees_block', 'agenda_block', 'resolutions_block', 'stockholders_present_block'];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  let allPass = true;

  for (const [category, values] of Object.entries(SAMPLE_VALUES_BY_CATEGORY)) {
    console.log(`\n[smoke] ${category}…`);

    // Look up storage path from document_templates by (category='corporate', subcategory=<kind>).
    const { data: tplRow, error: tplErr } = await supabase
      .from('document_templates')
      .select('template_storage_path')
      .eq('category', 'corporate')
      .eq('subcategory', category)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();
    if (tplErr || !tplRow) {
      console.error(`  ✗ no active document_template row for corporate/${category}`);
      allPass = false;
      continue;
    }
    const storagePath = tplRow.template_storage_path as string;

    // Download template.
    const { data: blob, error: dlErr } = await supabase.storage.from('templates').download(storagePath);
    if (dlErr || !blob) {
      console.error(`  ✗ download failed for ${storagePath}: ${dlErr?.message}`);
      allPass = false;
      continue;
    }
    const templateBuffer = Buffer.from(await blob.arrayBuffer());

    // Substitute.
    const filled = await substituteDocxPlaceholders(templateBuffer, values, { multilineKeys: MULTILINE_KEYS });

    // Inspect: open the filled DOCX, read document.xml, assert no
    // {{placeholder}} tokens for keys we provided remain.
    const zip = await JSZip.loadAsync(filled);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      console.error(`  ✗ filled DOCX missing document.xml`);
      allPass = false;
      continue;
    }
    const docXml = await docXmlFile.async('string');

    const leftover: string[] = [];
    for (const key of Object.keys(values)) {
      if (docXml.includes(`{{${key}}}`)) leftover.push(key);
    }

    // Also verify a non-trivial substituted value is present somewhere.
    const probeKey = Object.keys(values)[0];
    const probeValue = values[probeKey];
    const probePresent = probeValue ? docXml.includes(probeValue) : true;

    // Verify line breaks for multiline keys.
    let lineBreakCheckOk = true;
    for (const key of MULTILINE_KEYS) {
      if (values[key] && values[key].includes('\n') && !docXml.includes('<w:br/>')) {
        lineBreakCheckOk = false;
      }
    }

    if (leftover.length) {
      console.error(`  ✗ leftover placeholders for keys: ${leftover.join(', ')}`);
      allPass = false;
    }
    if (!probePresent) {
      console.error(`  ✗ probe value for ${probeKey} not found in output`);
      allPass = false;
    }
    if (!lineBreakCheckOk) {
      console.error(`  ✗ multiline keys present but no <w:br/> in output — multilineKeys handling broken`);
      allPass = false;
    }
    if (!leftover.length && probePresent && lineBreakCheckOk) {
      console.log(`  ✓ all placeholders substituted, probe value found, line breaks present`);
    }
  }

  if (!allPass) {
    console.error('\n[smoke] FAILED');
    process.exit(1);
  }
  console.log('\n[smoke] all 4 templates pass end-to-end substitution');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
