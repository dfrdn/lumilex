/**
 * Backfill file analyses — processes files directly using Claude API.
 * Usage: npx tsx scripts/backfill-analyses.ts
 *
 * For PDFs: sends directly to Claude via file content block
 * For DOCX: extracts text with mammoth then sends to Claude
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

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const claude = new Anthropic({ apiKey: anthropicKey });

const MODEL = 'claude-haiku-4-5-20251001';
const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'doc'];
const DELAY_MS = 1000;
const CONCURRENCY = 3;

const SYSTEM_PROMPT = `You are a legal document analyst for a Philippine law firm. Analyze the provided document and respond in JSON format:
{
  "summary": "Detailed 2-3 paragraph summary of the document content, key points, and legal significance",
  "shortSummary": "One sentence summary, max 100 characters",
  "entities": { "persons": [], "organizations": [], "dates": [], "amounts": [], "caseNumbers": [] }
}`;

function isSupportedFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS.includes(ext);
}

function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

async function analyzeFile(
  analysisId: number,
  fileId: string,
  attachmentName: string,
  storagePath: string,
  fileName: string,
  matterName: string,
): Promise<boolean> {
  try {
    await supabase.from('file_analyses').update({ status: 'processing' }).eq('id', analysisId);

    // Download from Supabase
    const { data: fileData, error: dlErr } = await supabase.storage.from('files').download(storagePath);
    if (dlErr || !fileData) throw new Error(`Download failed: ${dlErr?.message || 'no data'}`);

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const ext = getExt(attachmentName);
    const contextLine = matterName ? `\nMatter: "${matterName}"` : '';

    let response: Anthropic.Message;

    if (ext === 'pdf') {
      // Send PDF directly as base64 document content
      const base64 = buffer.toString('base64');
      response = await claude.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text: `Analyze this document. File: "${fileName}"${contextLine}`,
            },
          ],
        }],
      });
    } else {
      // DOCX: extract text with mammoth, then send as text
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value.slice(0, 50000); // Cap at 50k chars

      if (!text.trim()) {
        throw new Error('No text extracted from document');
      }

      response = await claude.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Analyze this legal document.\n\nFile: "${fileName}"${contextLine}\n\n--- DOCUMENT TEXT ---\n\n${text}`,
        }],
      });
    }

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON
    let parsed: { summary?: string; shortSummary?: string; entities?: Record<string, unknown> } = {};
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = { summary: responseText, shortSummary: responseText.slice(0, 100) };
    }

    await supabase.from('file_analyses').update({
      status: 'completed',
      summary: parsed.summary || responseText,
      short_summary: parsed.shortSummary || (parsed.summary || responseText).slice(0, 100),
      entities: parsed.entities || {},
      extracted_text: ext !== 'pdf' ? responseText.slice(0, 10000) : null,
      token_count_input: response.usage.input_tokens,
      token_count_output: response.usage.output_tokens,
      model_used: response.model,
      completed_at: new Date().toISOString(),
    }).eq('id', analysisId);

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed';
    await supabase.from('file_analyses').update({
      status: 'failed',
      error_message: message.slice(0, 500),
      completed_at: new Date().toISOString(),
    }).eq('id', analysisId);
    return false;
  }
}

async function main() {
  console.log('🔍 Counting files to backfill...\n');

  const { data: allFiles, error } = await supabase
    .from('files')
    .select('notion_id, name, matter_name, file_urls')
    .neq('file_urls', '[]')
    .order('created_time', { ascending: false });

  if (error) { console.error('Error:', error.message); process.exit(1); }

  // Get existing analyses
  const { data: existingAnalyses } = await supabase
    .from('file_analyses')
    .select('file_id, attachment_name, status')
    .in('status', ['completed', 'processing']);

  const analyzedSet = new Set(
    (existingAnalyses ?? []).map((a) => `${a.file_id}::${a.attachment_name}`),
  );

  // Clear previous failed/pending backfill attempts so they can be retried
  await supabase.from('file_analyses').delete().eq('status', 'failed').eq('analyzed_by', 'backfill');
  await supabase.from('file_analyses').delete().eq('status', 'pending').eq('analyzed_by', 'backfill');

  // Clean up zombie entries — any source stuck in 'processing' or 'pending' for > 30 minutes
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: staleProcessing } = await supabase.from('file_analyses').delete().eq('status', 'processing').lt('created_at', cutoff).select('id');
  const { data: stalePending } = await supabase.from('file_analyses').delete().eq('status', 'pending').lt('created_at', cutoff).select('id');
  const zombieCount = (staleProcessing?.length ?? 0) + (stalePending?.length ?? 0);
  if (zombieCount > 0) console.log(`🧹 Cleaned up ${zombieCount} zombie entries`);

  const toProcess: {
    fileId: string; name: string; matterName: string;
    attachmentName: string; storagePath: string;
  }[] = [];

  for (const file of allFiles ?? []) {
    const fileUrls: { name: string; url: string; path?: string }[] =
      typeof file.file_urls === 'string' ? JSON.parse(file.file_urls) : (file.file_urls ?? []);

    for (const att of fileUrls) {
      if (!isSupportedFile(att.name) || !att.path) continue;
      const key = `${file.notion_id}::${att.name}`;
      if (analyzedSet.has(key)) continue;
      toProcess.push({
        fileId: file.notion_id, name: file.name, matterName: file.matter_name ?? '',
        attachmentName: att.name, storagePath: att.path,
      });
    }
  }

  console.log(`📊 Total files: ${allFiles?.length ?? 0}`);
  console.log(`✅ Already analyzed: ${analyzedSet.size}`);
  console.log(`📝 To process: ${toProcess.length}\n`);

  if (toProcess.length === 0) { console.log('✨ Nothing to backfill!'); return; }

  let processed = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (item, j) => {
        const idx = i + j + 1;
        const progress = `[${idx}/${toProcess.length}]`;

        const { data: row, error: insertErr } = await supabase
          .from('file_analyses')
          .insert({
            file_id: item.fileId, attachment_name: item.attachmentName,
            attachment_url: item.storagePath, status: 'pending', analyzed_by: 'backfill',
          })
          .select('id').single();

        if (insertErr) {
          if (insertErr.code === '23505') { console.log(`${progress} ⏭️  Skip: ${item.attachmentName}`); return false; }
          console.error(`${progress} ❌ ${insertErr.message}`); return false;
        }

        const ok = await analyzeFile(row.id, item.fileId, item.attachmentName, item.storagePath, item.name, item.matterName);
        console.log(`${progress} ${ok ? '✓' : '✗'} ${item.name} / ${item.attachmentName}`);
        return ok;
      }),
    );

    for (const ok of results) { if (ok) processed++; else errors++; }

    if (i + CONCURRENCY < toProcess.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    if ((i + CONCURRENCY) % 30 === 0) {
      console.log(`\n📈 Progress: ${processed}✓ ${errors}✗ | ${toProcess.length - i - CONCURRENCY} remaining\n`);
    }
  }

  console.log(`\n✨ Done! Processed: ${processed}, Errors: ${errors}`);
}

main().catch(console.error);
