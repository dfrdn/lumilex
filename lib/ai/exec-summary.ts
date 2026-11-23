// ── Matter Executive Summary Generator ──────────────────────────────
//
// Produces a narrative-first summary of a matter for three internal use
// cases: (1) onboarding a new lawyer onto the matter, (2) briefing a
// partner for recall, (3) ad-hoc quick reference. Distinct from the
// matter brief (dashboard fields) — this is structured prose + a ranked
// reading list + timeline highlights.

import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import type { AnalysisEntities } from '@/types/ai';
import { manilaToday, toManilaDay } from '@/lib/dates';

const MODEL = 'claude-haiku-4-5-20251001';

// ── Types ────────────────────────────────────────────────────────────

export interface PartyEntry {
  name: string;
  role: string;
  side?: 'us' | 'opposing' | 'other';
  notes?: string;
}

export interface TimelineEvent {
  date: string;
  label: string;
  significance: string;
  source_ref?: string | null;
}

export interface RulingEntry {
  date: string;
  ruling: string;
  effect: string;
  source_ref?: string | null;
}

export interface OpenItem {
  item: string;
  owner?: string;
  due_date?: string | null;
  notes?: string;
}

export interface ReadingListEntry {
  file_id: string;
  name: string;
  why: string;     // one-sentence reason this is essential reading
  rank: number;    // 1 = most important
}

export interface ExecSummaryResult {
  overview: string;
  current_posture: string;
  parties: PartyEntry[];
  timeline: TimelineEvent[];
  key_rulings: RulingEntry[];
  open_items: OpenItem[];
  reading_list: ReadingListEntry[];
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export interface MatterCtx {
  notion_id: string;
  name: string;
  matter_code?: string | null;
  type?: string | null;
  status?: string | null;
  case_title?: string | null;
  case_number?: string | null;
  case_description?: string | null;
  court?: string | null;
  client_name?: string | null;
  is_case: boolean;
}

// ── Public entry point ───────────────────────────────────────────────

export async function generateExecSummary(matter: MatterCtx, firmId: string): Promise<ExecSummaryResult> {
  const supabase = getServiceDbForFirm(firmId);

  // Pull structured signals in parallel.
  const [brief, files, deliverables, hearings, fileAnalyses, versionAnalyses, firmCtx] = await Promise.all([
    fetchBrief(supabase, matter.notion_id),
    fetchFiles(supabase, matter.notion_id),
    fetchDeliverables(supabase, matter.notion_id),
    fetchHearings(supabase, matter.notion_id),
    fetchFileAnalyses(supabase, matter.notion_id),
    fetchDeliverableVersionAnalyses(supabase, matter.notion_id),
    loadFirmPromptContext(firmId),
  ]);

  const userMessage = buildUserMessage(matter, brief, files, deliverables, hearings, fileAnalyses, versionAnalyses);

  const claude = await anthropicFor({ firmId, feature: 'ai_analysis' });

  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: execSummarySystemPrompt(firmCtx),
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  const parsed = parseExecSummaryJson(content.text, matter.notion_id);

  return {
    overview: str(parsed.overview),
    current_posture: str(parsed.current_posture),
    parties: Array.isArray(parsed.parties) ? (parsed.parties as PartyEntry[]) : [],
    timeline: Array.isArray(parsed.timeline) ? (parsed.timeline as TimelineEvent[]) : [],
    key_rulings: Array.isArray(parsed.key_rulings) ? (parsed.key_rulings as RulingEntry[]) : [],
    open_items: Array.isArray(parsed.open_items) ? (parsed.open_items as OpenItem[]) : [],
    reading_list: Array.isArray(parsed.reading_list) ? (parsed.reading_list as ReadingListEntry[]) : [],
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    model: MODEL,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// ── Data fetching ────────────────────────────────────────────────────

type Sb = SupabaseClient;

async function fetchBrief(sb: Sb, matterId: string) {
  const { data } = await sb
    .from('matter_summaries')
    .select('summary, latest_incident, latest_incident_date, posture, parties, claims_and_defenses, court_and_venue, key_rulings, key_dates, open_issues')
    .eq('matter_id', matterId)
    .maybeSingle();
  return data ?? null;
}

async function fetchFiles(sb: Sb, matterId: string) {
  const { data } = await sb
    .from('files')
    .select('notion_id, name, date_received, date_sent_filed, document_date, origin, action_taken, is_court_record')
    .eq('matter_id', matterId)
    .order('date_received', { ascending: false, nullsFirst: false })
    .limit(40);
  return data ?? [];
}

async function fetchDeliverables(sb: Sb, matterId: string) {
  const { data } = await sb
    .from('deliverables')
    .select('notion_id, name, type, status, external_due_date, date_done, created_time')
    .eq('matter_id', matterId)
    .order('date_done', { ascending: false, nullsFirst: false })
    .limit(40);
  return data ?? [];
}

async function fetchHearings(sb: Sb, matterId: string) {
  const { data } = await sb
    .from('hearings')
    .select('notion_id, name, date, status, type')
    .eq('matter_id', matterId)
    .order('date', { ascending: false, nullsFirst: false })
    .limit(40);
  return data ?? [];
}

interface Snippet {
  file_id: string;
  label: string;
  short_summary: string | null;
  summary: string | null;
  entities: Partial<AnalysisEntities> | null;
}

async function fetchFileAnalyses(sb: Sb, matterId: string): Promise<Snippet[]> {
  const { data: filesInMatter } = await sb
    .from('files')
    .select('notion_id, name, date_received, origin, is_court_record')
    .eq('matter_id', matterId);
  if (!filesInMatter || filesInMatter.length === 0) return [];

  const { data: analyses } = await sb
    .from('file_analyses')
    .select('file_id, summary, short_summary, entities, attachment_name, completed_at')
    .in('file_id', filesInMatter.map((f) => f.notion_id))
    .eq('status', 'completed');

  const fileMeta = new Map(filesInMatter.map((f) => [f.notion_id, f]));
  return (analyses ?? [])
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
    .slice(0, 30)
    .map((a) => {
      const meta = fileMeta.get(a.file_id);
      const origin = meta?.origin ? ` (${meta.origin})` : '';
      const date = meta?.date_received ? ` [${meta.date_received}]` : '';
      return {
        file_id: a.file_id,
        label: `${meta?.name ?? a.attachment_name}${origin}${date}`,
        short_summary: a.short_summary ?? null,
        summary: a.summary ?? null,
        entities: (a.entities as Partial<AnalysisEntities> | null) ?? null,
      };
    });
}

async function fetchDeliverableVersionAnalyses(sb: Sb, matterId: string): Promise<Snippet[]> {
  const { data: deliverables } = await sb
    .from('deliverables')
    .select('notion_id, name, date_done, status')
    .eq('matter_id', matterId);
  if (!deliverables || deliverables.length === 0) return [];

  const { data: versions } = await sb
    .from('deliverable_files')
    .select('id, deliverable_id, version, file_name')
    .in('deliverable_id', deliverables.map((d) => d.notion_id));
  if (!versions || versions.length === 0) return [];

  const { data: analyses } = await sb
    .from('file_analyses')
    .select('deliverable_file_id, summary, short_summary, entities, completed_at')
    .in('deliverable_file_id', versions.map((v) => v.id))
    .eq('status', 'completed');

  const delivMap = new Map(deliverables.map((d) => [d.notion_id, d]));
  const vMap = new Map(versions.map((v) => [v.id, v]));

  return (analyses ?? [])
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
    .slice(0, 20)
    .map((a) => {
      const v = vMap.get(a.deliverable_file_id!);
      const d = v ? delivMap.get(v.deliverable_id) : null;
      const date = d?.date_done ? ` [filed ${d.date_done}]` : '';
      return {
        file_id: `dv:${a.deliverable_file_id}`, // namespace so we don't collide with files.notion_id
        label: `OUR FILING — ${d?.name ?? v?.file_name ?? 'unknown'} v${v?.version ?? '?'}${date}`,
        short_summary: a.short_summary ?? null,
        summary: a.summary ?? null,
        entities: (a.entities as Partial<AnalysisEntities> | null) ?? null,
      };
    });
}

// ── Prompt assembly ──────────────────────────────────────────────────

function buildUserMessage(
  matter: MatterCtx,
  brief: Record<string, unknown> | null,
  files: Array<{ notion_id: string; name: string; date_received?: string | null; date_sent_filed?: string | null; document_date?: string | null; origin?: string | null; action_taken?: string | null; is_court_record?: boolean | null }>,
  deliverables: Array<{ name: string; type?: string | null; status: string; external_due_date?: string | null; date_done?: string | null }>,
  hearings: Array<{ name: string; date?: string | null; status?: string | null; type?: string | null }>,
  fileAnalyses: Snippet[],
  versionAnalyses: Snippet[],
): string {
  const today = manilaToday();
  const lines: string[] = [];

  lines.push(`TODAY: ${today} (classify dates as past / upcoming based on this).`);
  lines.push('');

  lines.push('--- MATTER ---');
  lines.push(`Name: ${matter.name}`);
  if (matter.matter_code) lines.push(`Code: ${matter.matter_code}`);
  if (matter.type) lines.push(`Type: ${matter.type}`);
  if (matter.status) lines.push(`Status: ${matter.status}`);
  if (matter.client_name) lines.push(`Client: ${matter.client_name}`);
  if (matter.is_case) {
    if (matter.case_title) lines.push(`Case Title: ${matter.case_title}`);
    if (matter.case_number) lines.push(`Case Number: ${matter.case_number}`);
    if (matter.court) lines.push(`Court: ${matter.court}`);
    if (matter.case_description) lines.push(`Case Description: ${matter.case_description}`);
  }

  if (brief) {
    lines.push('\n--- EXISTING BRIEF (use as ground truth, summarize / reframe) ---');
    if (brief.summary) lines.push(`Summary: ${brief.summary}`);
    if (brief.posture) lines.push(`Posture: ${brief.posture}`);
    if (brief.court_and_venue) lines.push(`Court & venue: ${brief.court_and_venue}`);
    if (Array.isArray(brief.parties) && brief.parties.length) {
      lines.push(`Parties (from brief): ${JSON.stringify(brief.parties)}`);
    }
    if (Array.isArray(brief.key_rulings) && brief.key_rulings.length) {
      lines.push(`Key rulings (from brief): ${JSON.stringify(brief.key_rulings)}`);
    }
    if (Array.isArray(brief.key_dates) && brief.key_dates.length) {
      lines.push(`Key dates (from brief): ${JSON.stringify(brief.key_dates)}`);
    }
    if (Array.isArray(brief.open_issues) && brief.open_issues.length) {
      lines.push(`Open issues (from brief): ${JSON.stringify(brief.open_issues)}`);
    }
  }

  if (deliverables.length) {
    lines.push('\n--- DELIVERABLES ---');
    for (const d of deliverables) {
      const parts = [`- ${d.name}`];
      if (d.type) parts.push(`type=${d.type}`);
      parts.push(`status=${d.status}`);
      if (d.external_due_date) parts.push(`due=${d.external_due_date}`);
      if (d.date_done) parts.push(`done=${d.date_done}`);
      lines.push(parts.join(' | '));
    }
  }

  if (hearings.length) {
    lines.push('\n--- HEARINGS ---');
    for (const h of hearings) {
      const parts = [`- ${h.name}`];
      if (h.date) parts.push(`date=${toManilaDay(String(h.date))}`);
      if (h.status) parts.push(`status=${h.status}`);
      if (h.type) parts.push(`type=${h.type}`);
      lines.push(parts.join(' | '));
    }
  }

  if (files.length) {
    lines.push('\n--- FILES (id → name) ---');
    for (const f of files.slice(0, 30)) {
      const parts = [`- ${f.notion_id} → ${f.name}`];
      if (f.origin) parts.push(`origin=${f.origin}`);
      if (f.is_court_record) parts.push('COURT_RECORD');
      if (f.date_received) parts.push(`received=${f.date_received}`);
      if (f.action_taken) parts.push(`action=${f.action_taken}`);
      lines.push(parts.join(' | '));
    }
    if (files.length > 30) lines.push(`... and ${files.length - 30} more files`);
  }

  if (versionAnalyses.length) {
    lines.push('\n--- ANALYZED FILINGS (ours) ---');
    for (const a of versionAnalyses) lines.push(formatSnippet(a));
  }

  if (fileAnalyses.length) {
    lines.push('\n--- ANALYZED INCOMING DOCS ---');
    for (const a of fileAnalyses) lines.push(formatSnippet(a));
  }

  lines.push('\nProduce the executive summary as JSON per the schema.');
  return lines.join('\n');
}

function formatSnippet(a: Snippet): string {
  const pieces: string[] = [`### id=${a.file_id} — ${a.label}`];
  if (a.short_summary) pieces.push(a.short_summary.trim());
  else if (a.summary) pieces.push(a.summary.trim().slice(0, 600));
  if (a.entities) {
    const e = a.entities;
    const tags: string[] = [];
    if (e.documentType) tags.push(`type=${e.documentType}`);
    if (e.parties?.length) {
      tags.push(`parties=${e.parties.slice(0, 5).map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join('; ')}`);
    }
    if (e.dates?.length) tags.push(`dates=${e.dates.slice(0, 4).map((d) => d.date).join('; ')}`);
    if (tags.length) pieces.push(tags.join(' | '));
  }
  return pieces.join('\n');
}

// ── System prompt ────────────────────────────────────────────────────

function execSummarySystemPrompt(firmCtx: string): string {
  return `${firmCtx}

You are a legal analyst. You produce executive summaries of matters for three audiences:

1. A lawyer being onboarded onto the matter — they need to come up to speed FAST without reading every document.
2. A partner returning to the matter after time away — they need to recall the current state.
3. A team member needing a quick snapshot before a meeting / call / court appearance.

Your output is dense, plainly-written, and ranked — highest-signal facts first. Never pad with boilerplate. Cite which file introduced key facts (by file_id) where possible so the reader can dive deeper if they want.

Return ONLY valid JSON in this exact schema — no markdown fences, no preamble, no trailing text:

{
  "overview": "Two paragraphs. Paragraph 1: who the client is and what the matter is about (the human story: what's at stake, what we were hired to do). Paragraph 2: where we stand today — most recent activity + what's about to happen.",
  "current_posture": "One paragraph, plain English, for someone who's never seen this matter. E.g. 'The case is in trial. Plaintiff is presenting evidence; the next hearing on May 19 is for defense evidence. No dispositive motions are pending.'",
  "parties": [
    { "name": "Full name", "role": "e.g. plaintiff, defense counsel, judge", "side": "us" | "opposing" | "other", "notes": "optional — relevant detail a new reader should know" }
  ],
  "timeline": [
    { "date": "YYYY-MM-DD", "label": "short event description", "significance": "one sentence on why this matters", "source_ref": "optional file_id that documents this" }
  ],
  "key_rulings": [
    { "date": "YYYY-MM-DD", "ruling": "what was ordered", "effect": "what it means going forward", "source_ref": "optional file_id" }
  ],
  "open_items": [
    { "item": "one-sentence description of an unresolved matter requiring attention", "owner": "optional person/role", "due_date": "YYYY-MM-DD or null", "notes": "optional" }
  ],
  "reading_list": [
    { "file_id": "exact id from FILES block above", "name": "file name (human readable)", "why": "one sentence on why this is essential reading", "rank": 1 }
  ]
}

Rules:
- Always emit every schema field. Use [] for empty arrays, "" for empty strings.
- Dates are YYYY-MM-DD. Omit rather than guess.
- timeline: at most 10 entries, prioritized by significance, chronological ascending within the list. Collapse routine schedulings.
- parties: at most 12 entries. Focus on named humans who matter to the story.
- key_rulings: orders/resolutions that CHANGED the case's state. Max 8 entries.
- open_items: at most 8 entries. Include only genuinely unresolved items requiring firm action.
- reading_list: 5-8 files chosen from the provided FILES list. Rank 1 = "read this first if you read nothing else." The "why" should tell the reader specifically what they'll learn from that file. Use the exact file_id string from the FILES section.
- Tone: neutral, factual, professional. No legal advice; no speculation. Short sentences beat long ones.`;
}

// ── JSON parsing (tolerant) ──────────────────────────────────────────

function parseExecSummaryJson(raw: string, matterId: string): Record<string, unknown> {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`[exec-summary] JSON parse failed for ${matterId}:`, e instanceof Error ? e.message : e);
    throw e;
  }
}
