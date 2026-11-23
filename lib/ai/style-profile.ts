// Drafting house-style profiles.
//
// Per document type, distil HOW the firm writes it from its own finalized
// filings — section skeleton, tone, prayer patterns, citation habits, phrasing —
// and store it. draft-grounding injects the matching profile so every draft
// follows the house style. Where exemplar retrieval shows ONE similar filing,
// the profile generalizes the pattern across many.

import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import { FINALIZED_STATUSES } from '@/lib/deliverable-status';

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_SAMPLE_CHARS = 8000; // per example, keeps the distillation prompt bounded
const MIN_SAMPLES = 2;

export interface StyleProfileResult {
  docTypeKey: string;
  documentType: string;
  sampleCount: number;
  skipped?: string; // reason, when nothing was written
}

function normalizeKey(documentType: string): string {
  return documentType.trim().toLowerCase().replace(/\s+/g, ' ');
}

function inferFormat(documentType: string): 'pleading' | 'letter' | 'status_report' {
  const t = documentType.toLowerCase();
  if (/status report/.test(t)) return 'status_report';
  if (/letter|opinion|memo to client|demand/.test(t)) return 'letter';
  return 'pleading';
}

interface Sample {
  deliverableId: string;
  text: string;
}

/**
 * Gather finalized examples of `documentType`. Starts from the ANALYZED set —
 * only a fraction of finalized deliverables have a completed analysis, so
 * fetching the most recent by name and then filtering to analyzed ones misses
 * almost everything. Instead: find matching finalized deliverables, resolve
 * their versions, then keep those with a completed analysis (one per
 * deliverable, most-recent analysis first).
 */
async function gatherSamples(documentType: string, maxSamples: number, firmId: string): Promise<Sample[]> {
  const supabase = getServiceDbForFirm(firmId);

  // Firms name these many ways ("Comment/Opposition" vs "Comment…" vs
  // "Opposition…"), so match ANY slash-separated segment of the type against
  // name OR subtype.
  const segments = documentType.split('/').map((s) => s.trim()).filter((s) => s.length >= 3);
  const orClauses = (segments.length > 0 ? segments : [documentType.trim()])
    .flatMap((seg) => [`name.ilike.%${seg}%`, `subtype.ilike.%${seg}%`])
    .join(',');

  // 1. Finalized deliverables whose name/subtype matches the type.
  const { data: delivs } = await supabase
    .from('deliverables')
    .select('notion_id')
    .in('status', FINALIZED_STATUSES)
    .or(orClauses)
    .limit(400);
  if (!delivs || delivs.length === 0) return [];
  const deliverableIds = delivs.map((d) => d.notion_id);

  // 2. All their version files → map df.id → deliverable_id.
  const { data: dfRows } = await supabase
    .from('deliverable_files')
    .select('id, deliverable_id')
    .in('deliverable_id', deliverableIds);
  if (!dfRows || dfRows.length === 0) return [];
  const dfToDeliverable = new Map<number, string>(dfRows.map((r) => [r.id as number, r.deliverable_id as string]));

  // 3. Completed analyses for those versions, richest/most-recent first.
  const { data: analyses } = await supabase
    .from('file_analyses')
    .select('deliverable_file_id, extracted_text, created_at')
    .in('deliverable_file_id', [...dfToDeliverable.keys()])
    .eq('status', 'completed')
    .not('extracted_text', 'is', null)
    .order('created_at', { ascending: false });
  if (!analyses || analyses.length === 0) return [];

  // One sample per deliverable (keep the most recent analysis), capped.
  const seen = new Set<string>();
  const samples: Sample[] = [];
  for (const a of analyses) {
    if (samples.length >= maxSamples) break;
    const deliverableId = dfToDeliverable.get(a.deliverable_file_id as number);
    if (!deliverableId || seen.has(deliverableId)) continue;
    const text = (a.extracted_text as string | null)?.trim();
    if (!text || text.length <= 400) continue;
    seen.add(deliverableId);
    samples.push({ deliverableId, text: text.slice(0, MAX_SAMPLE_CHARS) });
  }
  return samples;
}

function systemPrompt(firmCtx: string): string {
  return `${firmCtx}

You are a legal writing analyst. You are given several of the firm's OWN finalized documents of one type. Distil a reusable HOUSE-STYLE PROFILE that a drafter could follow to produce a new document of this type that reads like the firm's own work.

Extract PATTERNS, never matter-specific content. Do NOT include any party names, facts, figures, dates, or citations from the samples — only the conventions.

Return concise markdown with these sections (omit one only if the samples truly show no pattern):
- **Structure**: the section skeleton in order (e.g. caption → prefatory statement → statement of facts → arguments → prayer), with how sections are titled.
- **Opening**: how the document opens (lead-in lines, standard phrasing).
- **Argument style**: how points are framed and sequenced, paragraph length, numbering.
- **Tone & register**: voice, formality, characteristic connectives/transitions the firm favors.
- **Prayer / closing**: how relief/closing is phrased.
- **Citations**: how authorities are cited (footnotes vs in-text, short forms).
- **Formatting notes**: any consistent conventions (currency, dates, emphasis, defined terms).
- **Characteristic phrasings**: 3–8 short signature phrases the firm reuses (verbatim snippets that carry no matter-specific facts).

Be specific and prescriptive. Keep it under ~600 words.`;
}

async function distill(documentType: string, samples: Sample[], model: string, firmId: string): Promise<string> {
  const claude = await anthropicFor({ firmId, feature: 'drafting' });

  const body = samples
    .map((s, i) => `--- SAMPLE ${i + 1} ---\n${s.text}`)
    .join('\n\n');
  const userMessage = `DOCUMENT TYPE: ${documentType}\nNUMBER OF SAMPLES: ${samples.length}\n\n${body}\n\nDistil the house-style profile per the schema.`;

  const response = await claude.messages.create({
    model,
    max_tokens: 2048,
    system: systemPrompt(await loadFirmPromptContext(firmId)),
    messages: [{ role: 'user', content: userMessage }],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No profile returned');
  return block.text.trim();
}

/**
 * Build (or rebuild) the house-style profile for one document type and upsert it.
 * Returns a skip reason when there aren't enough finalized examples yet.
 */
export async function buildStyleProfile(
  documentType: string,
  opts: { firmId: string; format?: 'pleading' | 'letter' | 'status_report'; maxSamples?: number; model?: string },
): Promise<StyleProfileResult> {
  const docTypeKey = normalizeKey(documentType);
  const format = opts.format ?? inferFormat(documentType);
  const model = opts.model ?? DEFAULT_MODEL;

  const samples = await gatherSamples(documentType, opts.maxSamples ?? 8, opts.firmId);
  if (samples.length < MIN_SAMPLES) {
    return { docTypeKey, documentType, sampleCount: samples.length, skipped: `only ${samples.length} finalized sample(s)` };
  }

  const profileMd = await distill(documentType, samples, model, opts.firmId);

  const supabase = getServiceDbForFirm(opts.firmId);
  const { error } = await supabase
    .from('drafting_style_profiles')
    .upsert(
      {
        doc_type_key: docTypeKey,
        document_type: documentType,
        format,
        profile_md: profileMd,
        sample_count: samples.length,
        source_deliverable_ids: samples.map((s) => s.deliverableId),
        model_used: model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,doc_type_key' },
    );
  if (error) throw new Error(`Failed to upsert style profile: ${error.message}`);

  return { docTypeKey, documentType, sampleCount: samples.length };
}

/**
 * Fetch the house-style profile most relevant to a draft of `documentType`.
 * Bidirectional substring match on the canonical key (so "Motion for
 * Reconsideration (Ad Cautelam)" matches a "motion for reconsideration"
 * profile, and vice-versa), preferring the most specific (longest) key.
 * Uses the service-role client — draft-grounding runs service-role.
 */
export async function getStyleProfileForDraft(documentType: string, firmId: string): Promise<{ documentType: string; profileMd: string } | null> {
  const key = normalizeKey(documentType);
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('drafting_style_profiles')
    .select('doc_type_key, document_type, profile_md');
  if (!data || data.length === 0) return null;

  const matches = data
    .filter((p) => key.includes(p.doc_type_key) || p.doc_type_key.includes(key))
    .sort((a, b) => b.doc_type_key.length - a.doc_type_key.length);
  const best = matches[0];
  return best ? { documentType: best.document_type, profileMd: best.profile_md } : null;
}
