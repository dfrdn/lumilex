/**
 * Exercise the Drafting Studio core (grounding assembly + grounded DOCX
 * generation) without the HTTP/session/browser-timeout layer. Verifies the
 * Sonnet path, the token budget, and the salvage parser.
 *
 * Usage:
 *   NODE_OPTIONS=--experimental-websocket npx tsx scripts/test-drafting.ts <matterId> "<documentType>"
 */

import { readFileSync, writeFileSync } from 'fs';

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
import { assembleDraftGrounding } from '../lib/ai/draft-grounding';
import { generateDocumentDocx } from '../lib/docx/template-generator';

async function main() {
  const matterId = process.argv[2];
  if (!matterId) throw new Error('usage: test-drafting.ts <matterId> "<documentType>"');
  const documentType = process.argv[3] ?? 'Position Paper';

  const supabase = getSupabase();
  const { data: matter } = await supabase
    .from('matters')
    .select('name, matter_code, type, case_title, case_number, court, client_name, firm_id')
    .eq('notion_id', matterId)
    .single();

  console.log(`Matter: ${matter?.name}\nDrafting: ${documentType}\n`);

  console.log('── Assembling grounding ──');
  const grounding = await assembleDraftGrounding({ firmId: matter!.firm_id, matterId, documentType });
  console.log(`  brief: ${grounding.briefBlock ? 'yes' : 'no'}`);
  console.log(`  KB pages: ${grounding.kbPages.map((p) => p.title).join(' | ') || 'none'}`);
  console.log(`  prior work: ${grounding.priorWork.map((w) => w.title).join(' | ') || 'none'}`);

  console.log('\n── Drafting (Sonnet, grounded) ──');
  const t0 = Date.now();
  const { buffer, truncated } = await generateDocumentDocx({
    firmId: matter!.firm_id,
    templatePrompt: `Draft a "${documentType}" for this matter. Produce a complete, well-structured ${documentType} ready for a lawyer's review.`,
    matterContext: {
      name: matter?.name ?? undefined,
      matterCode: matter?.matter_code ?? undefined,
      type: matter?.type ?? undefined,
      caseTitle: matter?.case_title ?? undefined,
      caseNumber: matter?.case_number ?? undefined,
      court: matter?.court ?? undefined,
      clientName: matter?.client_name ?? undefined,
    },
    groundingContext: grounding.promptBlock,
    model: 'claude-sonnet-4-6',
    maxTokens: 16384,
  });

  const outPath = '/tmp/test-draft.docx';
  writeFileSync(outPath, buffer);
  console.log(`\nPASS — generated ${(buffer.length / 1024).toFixed(1)}KB DOCX in ${((Date.now() - t0) / 1000).toFixed(0)}s${truncated ? ' (TRUNCATED)' : ''} → ${outPath}`);
}

main().catch((err) => {
  console.error('\nFAIL:', err);
  process.exit(1);
});
