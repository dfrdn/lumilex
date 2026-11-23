/**
 * Script to generate AI summaries for all matters.
 * Run with: npx tsx scripts/generate-all-summaries.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load .env.local manually
const envPath = path.resolve(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const val = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) process.env[key] = val;
}
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are a legal assistant that summarizes matters (cases) for a law firm dashboard.
Given a matter and its related entities (deliverables, hearings, filings, files, tasks), provide:
1. A concise 1-2 sentence summary of the matter's current state
2. The latest significant incident (new deliverable, hearing, filing, or file)
3. The date of that latest incident

Respond ONLY with raw JSON (no markdown, no code fences, no extra text):
{"summary": "1-2 sentence summary", "latestIncident": "Brief description of latest incident or null", "latestIncidentDate": "YYYY-MM-DD or null"}`;

interface MatterRow {
  notion_id: string;
  name: string;
  matter_code: string;
  type: string;
  status: string;
  case_title: string;
  case_number: string;
  court: string;
  client_name: string;
}

async function getRelatedEntities(matterId: string) {
  const [deliverables, hearings, files, tasks] = await Promise.all([
    supabase.from('deliverables').select('name, status, external_due_date, created_time').eq('matter_id', matterId),
    supabase.from('hearings').select('name, date, status, type').eq('matter_id', matterId),
    supabase.from('files').select('name, date_received, origin').eq('matter_id', matterId),
    supabase.from('tasks').select('name, status, due_date, done').eq('matter_id', matterId),
  ]);

  return {
    deliverables: (deliverables.data || []).map((d) => `- ${d.name} [${d.status}] due ${d.external_due_date || 'N/A'}`),
    hearings: (hearings.data || []).map((h) => `- ${h.name} [${h.status}] on ${h.date || 'N/A'} (${h.type || ''})`),
    files: (files.data || []).slice(0, 20).map((f) => `- ${f.name} received ${f.date_received || 'N/A'}`),
    tasks: (tasks.data || []).slice(0, 15).map((t) => `- ${t.name} [${t.status}] ${t.done ? '✓' : ''}`),
  };
}

async function generateSummary(matter: MatterRow) {
  const entities = await getRelatedEntities(matter.notion_id);

  const context = [
    `Matter: ${matter.name}`,
    `Code: ${matter.matter_code || 'N/A'}`,
    `Type: ${matter.type || 'N/A'}`,
    `Status: ${matter.status || 'N/A'}`,
    `Case Title: ${matter.case_title || 'N/A'}`,
    `Case Number: ${matter.case_number || 'N/A'}`,
    `Court: ${matter.court || 'N/A'}`,
    `Client: ${matter.client_name || 'N/A'}`,
    '',
    entities.deliverables.length ? `Deliverables:\n${entities.deliverables.join('\n')}` : 'No deliverables.',
    entities.hearings.length ? `Hearings:\n${entities.hearings.join('\n')}` : 'No hearings.',
    entities.files.length ? `Files:\n${entities.files.join('\n')}` : 'No files.',
    entities.tasks.length ? `Tasks:\n${entities.tasks.join('\n')}` : 'No tasks.',
  ].join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: context }],
  });

  let text = response.content[0].type === 'text' ? response.content[0].text : '';
  // Strip markdown code fences if model wraps response
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(text);

  return {
    summary: parsed.summary,
    latestIncident: parsed.latestIncident || null,
    latestIncidentDate: parsed.latestIncidentDate || null,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

async function main() {
  console.log('Fetching all matters...');
  const { data: matters, error } = await supabase
    .from('matters')
    .select('notion_id, name, matter_code, type, status, case_title, case_number, court, client_name')
    .order('name');

  if (error || !matters) {
    console.error('Failed to fetch matters:', error);
    process.exit(1);
  }

  // Check which already have summaries
  const { data: existing } = await supabase.from('matter_summaries').select('matter_id');
  const existingSet = new Set((existing || []).map((e) => e.matter_id));
  const pending = matters.filter((m) => !existingSet.has(m.notion_id));

  console.log(`Total matters: ${matters.length}, already summarized: ${existingSet.size}, pending: ${pending.length}`);

  if (pending.length === 0) {
    console.log('All matters already have summaries!');
    return;
  }

  let succeeded = 0;
  let failed = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const BATCH_SIZE = 3;
  const DELAY_MS = 4000; // ~3 req per 4s = 45/min, under 50/min limit

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (matter) => {
        const result = await generateSummary(matter);
        await supabase.from('matter_summaries').upsert({
          matter_id: matter.notion_id,
          summary: result.summary,
          latest_incident: result.latestIncident,
          latest_incident_date: result.latestIncidentDate,
          model_used: MODEL,
          token_count_input: result.inputTokens,
          token_count_output: result.outputTokens,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'matter_id' });
        return { name: matter.name, ...result };
      }),
    );

    // Rate limit delay between batches
    if (i + BATCH_SIZE < pending.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }

    for (const r of results) {
      if (r.status === 'fulfilled') {
        succeeded++;
        totalInput += r.value.inputTokens;
        totalOutput += r.value.outputTokens;
        console.log(`✓ [${succeeded + failed}/${pending.length}] ${r.value.name}`);
      } else {
        failed++;
        console.error(`✗ [${succeeded + failed}/${pending.length}] ${r.reason?.message || r.reason}`);
      }
    }
  }

  const costInput = (totalInput / 1_000_000) * 0.80;
  const costOutput = (totalOutput / 1_000_000) * 4.00;
  console.log(`\nDone! Succeeded: ${succeeded}, Failed: ${failed}`);
  console.log(`Tokens — Input: ${totalInput}, Output: ${totalOutput}`);
  console.log(`Cost — Input: $${costInput.toFixed(4)}, Output: $${costOutput.toFixed(4)}, Total: $${(costInput + costOutput).toFixed(4)}`);
}

main().catch(console.error);
