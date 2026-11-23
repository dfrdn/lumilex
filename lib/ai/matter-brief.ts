// ── Matter Brief Generator (Phase 1 matter wiki) ─────────────────────
//
// Produces a structured, maintained brief of a matter that sits between
// raw documents and RAG retrieval. Branches on whether the matter is a
// case (has case_title or case_number) — cases get the full litigation
// brief; non-cases get a lighter summary + key_dates + open_issues.
//
// Inputs: matter metadata + all completed file_analyses + deliverable
// version analyses + deliverables/hearings/filings/files/tasks lists.
// Output: a typed MatterBriefResult persisted to matter_summaries.

import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { DELIVERABLE_LIFECYCLE_NOTE } from '@/lib/ai/matter-deliverables';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import { searchJurisprudence, topJurisprudenceHits } from '@/lib/juris';
import type { AnalysisEntities } from '@/types/ai';
import { manilaToday, toManilaDay } from '@/lib/dates';

const MODEL = 'claude-haiku-4-5-20251001';

const BRIEF_VERSION = 1;

// ── Types ────────────────────────────────────────────────────────────

export interface KeyDate {
  date: string;         // YYYY-MM-DD
  label: string;
  status?: 'upcoming' | 'past' | 'contingent';
  source_ref?: string | null;
}

export interface OpenIssue {
  issue: string;
  source_refs?: string[];
  flagged_at?: string | null;
}

export interface PartyEntry {
  name: string;
  role: string;                          // e.g. "petitioner", "counsel for respondent"
  side?: 'us' | 'opposing' | 'other';
  notes?: string;
}

export interface ClaimEntry {
  party: string;
  theory: string;
  source_refs?: string[];
}

export interface RulingEntry {
  date: string;                          // YYYY-MM-DD
  ruling: string;
  effect: string;
  source_refs?: string[];
}

/** An SC decision surfaced from juris.ph by semantic match on the brief's facts. */
export interface RelevantAuthority {
  case_number: string;
  case_title: string;
  decision_date?: string;
  snippet?: string;
  tags?: string[];
  url: string;
  score?: number;
}

export interface MatterBriefResult {
  brief_version: number;

  // Shared.
  summary: string;                       // 1-paragraph narrative (4-8 sentences)
  latest_incident: string | null;
  latest_incident_date: string | null;
  key_dates: KeyDate[];
  open_issues: OpenIssue[];

  // Cases only (null/empty for non-cases).
  posture: string | null;
  parties: PartyEntry[] | null;
  claims_and_defenses: ClaimEntry[] | null;
  court_and_venue: string | null;
  key_rulings: RulingEntry[] | null;
  relevant_authorities: RelevantAuthority[] | null;

  // Meta.
  input_tokens: number;
  output_tokens: number;
  model: string;
}

// ── Input shapes ─────────────────────────────────────────────────────

export interface MatterContext {
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
  /** Scopes every read. */
  firmId: string;
}

interface AnalysisSnippet {
  source_label: string;                  // e.g. "Document: Counter-Affidavit (2025-10-22)"
  short_summary: string | null;
  summary: string | null;
  entities: Partial<AnalysisEntities> | null;
}

// ── Public entry point ───────────────────────────────────────────────

export async function generateMatterBrief(matter: MatterContext): Promise<MatterBriefResult> {
  const supabase = getServiceDbForFirm(matter.firmId);

  // Collect all signals: file analyses, deliverable-version analyses,
  // deliverables, hearings, filings, files, tasks.
  const [fileAnalyses, versionAnalyses, deliverables, hearings, files, tasks, firmCtx] = await Promise.all([
    fetchFileAnalyses(supabase, matter.notion_id),
    fetchDeliverableVersionAnalyses(supabase, matter.notion_id),
    fetchDeliverables(supabase, matter.notion_id),
    fetchHearings(supabase, matter.notion_id),
    fetchFiles(supabase, matter.notion_id),
    fetchTasks(supabase, matter.notion_id),
    loadFirmPromptContext(matter.firmId),
  ]);

  const userMessage = buildUserMessage(
    matter,
    fileAnalyses,
    versionAnalyses,
    deliverables,
    hearings,
    files,
    tasks,
  );

  const system = matter.is_case ? caseSystemPrompt(firmCtx) : nonCaseSystemPrompt(firmCtx);

  const claude = await anthropicFor({ firmId: matter.firmId, feature: 'ai_analysis' });

  // Cases need a bigger output budget — a fully-populated litigation brief
  // with parties + claims + rulings + dates + issues can easily exceed 4k.
  // Haiku 4.5 caps output at 16k; use that for cases so very long-running
  // matters (Rafer, Cacho) don't get truncated mid-JSON.
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: matter.is_case ? 16384 : 4096,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn(
      `[matter-brief] Output truncated for ${matter.notion_id} (${matter.is_case ? 'case' : 'non-case'}). Consider trimming input or raising max_tokens.`,
    );
  }

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  const parsed = parseBriefJson(content.text, matter.notion_id);
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

  // Cases get a jurisprudence pass: semantic-search juris.ph with the fresh
  // factual narrative. Best-effort — an outage just leaves the section null.
  const summaryText = String(parsed.summary ?? '').trim();
  const relevantAuthorities = matter.is_case && summaryText
    ? await findRelevantAuthorities(summaryText, matter)
    : null;

  return {
    brief_version: BRIEF_VERSION,
    summary: String(parsed.summary ?? '').trim(),
    latest_incident: str(parsed.latest_incident),
    latest_incident_date: str(parsed.latest_incident_date),
    key_dates: Array.isArray(parsed.key_dates) ? parsed.key_dates as KeyDate[] : [],
    open_issues: Array.isArray(parsed.open_issues) ? parsed.open_issues as OpenIssue[] : [],
    posture: matter.is_case ? str(parsed.posture) : null,
    parties: matter.is_case && Array.isArray(parsed.parties) ? parsed.parties as PartyEntry[] : null,
    claims_and_defenses: matter.is_case && Array.isArray(parsed.claims_and_defenses)
      ? parsed.claims_and_defenses as ClaimEntry[] : null,
    court_and_venue: matter.is_case ? str(parsed.court_and_venue) : null,
    key_rulings: matter.is_case && Array.isArray(parsed.key_rulings) ? parsed.key_rulings as RulingEntry[] : null,
    relevant_authorities: relevantAuthorities,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    model: MODEL,
  };
}

async function findRelevantAuthorities(
  summary: string,
  matter: MatterContext,
): Promise<RelevantAuthority[] | null> {
  const query = [summary, matter.case_description ?? ''].join('\n').slice(0, 2000);
  const hits = await searchJurisprudence(query, { limit: 8 });
  if (hits === null) return null;
  return topJurisprudenceHits(hits, { limit: 5 }).map((h) => ({
    case_number: h.case_number,
    case_title: h.case_title?.slice(0, 200) ?? h.case_number,
    decision_date: h.decision_date,
    snippet: h.facts?.slice(0, 300),
    tags: h.tags?.slice(0, 5),
    url: h.url,
    score: h.score,
  }));
}

// ── Data fetching ────────────────────────────────────────────────────

type Sb = SupabaseClient;

/**
 * Cap on how many per-file analysis snippets we feed to the generator.
 * Massive cases (Rafer, Reyes, etc.) with 100+ analyzed files can produce
 * briefs so long they overrun the output cap, truncate, and lose detail
 * across the board. Tightening input forces the model to prioritize —
 * you still get every ruling and major filing, just summarized more
 * tightly. The cap scales so small matters aren't needlessly starved.
 */
function fileSnippetCap(totalAnalyzedCount: number): number {
  if (totalAnalyzedCount > 100) return 25;
  if (totalAnalyzedCount > 50) return 30;
  return 40;
}

async function fetchFileAnalyses(sb: Sb, matterId: string): Promise<AnalysisSnippet[]> {
  const { data: filesInMatter } = await sb
    .from('files')
    .select('notion_id, name, date_received, origin')
    .eq('matter_id', matterId);
  if (!filesInMatter || filesInMatter.length === 0) return [];

  const fileIds = filesInMatter.map((f) => f.notion_id);
  const { data: analyses } = await sb
    .from('file_analyses')
    .select('file_id, summary, short_summary, entities, attachment_name, completed_at')
    .in('file_id', fileIds)
    .eq('status', 'completed');

  const fileMeta = new Map(filesInMatter.map((f) => [f.notion_id, f]));
  const cap = fileSnippetCap((analyses ?? []).length);
  return (analyses ?? [])
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
    .slice(0, cap)
    .map((a) => {
      const meta = fileMeta.get(a.file_id);
      const origin = meta?.origin ? ` (${meta.origin})` : '';
      const date = meta?.date_received ? ` [${meta.date_received}]` : '';
      return {
        source_label: `File: ${meta?.name ?? a.attachment_name}${origin}${date}`,
        short_summary: a.short_summary ?? null,
        summary: a.summary ?? null,
        entities: (a.entities as Partial<AnalysisEntities> | null) ?? null,
      };
    });
}

async function fetchDeliverableVersionAnalyses(sb: Sb, matterId: string): Promise<AnalysisSnippet[]> {
  const { data: deliverables } = await sb
    .from('deliverables')
    .select('notion_id, name, type, status, date_done')
    .eq('matter_id', matterId);
  if (!deliverables || deliverables.length === 0) return [];

  const deliverableIds = deliverables.map((d) => d.notion_id);
  const { data: versions } = await sb
    .from('deliverable_files')
    .select('id, deliverable_id, version, file_name')
    .in('deliverable_id', deliverableIds);
  if (!versions || versions.length === 0) return [];

  const versionIds = versions.map((v) => v.id);
  const { data: analyses } = await sb
    .from('file_analyses')
    .select('deliverable_file_id, summary, short_summary, entities, completed_at')
    .in('deliverable_file_id', versionIds)
    .eq('status', 'completed');

  const deliverableMeta = new Map(deliverables.map((d) => [d.notion_id, d]));
  const versionMeta = new Map(versions.map((v) => [v.id, v]));

  return (analyses ?? [])
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
    .map((a) => {
      const v = versionMeta.get(a.deliverable_file_id!);
      const d = v ? deliverableMeta.get(v.deliverable_id) : null;
      return {
        source_label: `Our Filing: ${d?.name ?? v?.file_name ?? 'unknown'} v${v?.version ?? '?'}${d?.date_done ? ` [filed ${d.date_done}]` : ''}`,
        short_summary: a.short_summary ?? null,
        summary: a.summary ?? null,
        entities: (a.entities as Partial<AnalysisEntities> | null) ?? null,
      };
    });
}

async function fetchDeliverables(sb: Sb, matterId: string) {
  const { data } = await sb
    .from('deliverables')
    .select('notion_id, name, type, status, external_due_date, date_done, created_time')
    .eq('matter_id', matterId);
  return data ?? [];
}

async function fetchHearings(sb: Sb, matterId: string) {
  const { data } = await sb
    .from('hearings')
    .select('notion_id, name, date, status, type')
    .eq('matter_id', matterId);
  return data ?? [];
}

async function fetchFiles(sb: Sb, matterId: string) {
  const { data } = await sb
    .from('files')
    .select('notion_id, name, date_received, origin')
    .eq('matter_id', matterId)
    .order('date_received', { ascending: false, nullsFirst: false })
    .limit(50);
  return data ?? [];
}

async function fetchTasks(sb: Sb, matterId: string) {
  const { data } = await sb
    .from('tasks')
    .select('notion_id, name, status, due_date, done')
    .eq('matter_id', matterId);
  return data ?? [];
}

// ── Prompt assembly ──────────────────────────────────────────────────

function buildUserMessage(
  matter: MatterContext,
  fileAnalyses: AnalysisSnippet[],
  versionAnalyses: AnalysisSnippet[],
  deliverables: Array<{ name: string; type?: string | null; status: string; external_due_date?: string | null; date_done?: string | null }>,
  hearings: Array<{ name: string; date?: string | null; status?: string | null; type?: string | null }>,
  files: Array<{ name: string; date_received?: string | null; origin?: string | null }>,
  tasks: Array<{ name: string; status?: string | null; due_date?: string | null; done?: boolean | null }>,
): string {
  const lines: string[] = [];

  const today = manilaToday();
  lines.push(`TODAY'S DATE: ${today} (use this to classify dates as past / upcoming).`);
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
    lines.push('\n--- RECEIVED FILES ---');
    for (const f of files.slice(0, 30)) {
      const parts = [`- ${f.name}`];
      if (f.origin) parts.push(`origin=${f.origin}`);
      if (f.date_received) parts.push(`received=${f.date_received}`);
      lines.push(parts.join(' | '));
    }
    if (files.length > 30) lines.push(`... and ${files.length - 30} more files`);
  }

  if (tasks.length) {
    lines.push('\n--- OPEN TASKS ---');
    for (const t of tasks.filter((t) => !t.done).slice(0, 20)) {
      const parts = [`- ${t.name}`];
      if (t.status) parts.push(`status=${t.status}`);
      if (t.due_date) parts.push(`due=${t.due_date}`);
      lines.push(parts.join(' | '));
    }
  }

  if (versionAnalyses.length) {
    lines.push('\n--- OUR FILINGS (analyzed) ---');
    for (const a of versionAnalyses) lines.push(formatAnalysisSnippet(a));
  }

  if (fileAnalyses.length) {
    lines.push('\n--- INCOMING DOCUMENTS (analyzed) ---');
    for (const a of fileAnalyses) lines.push(formatAnalysisSnippet(a));
  }

  lines.push('\nGenerate the matter brief as JSON per the schema.');
  return lines.join('\n');
}

function formatAnalysisSnippet(a: AnalysisSnippet): string {
  const pieces: string[] = [`### ${a.source_label}`];
  if (a.short_summary) pieces.push(a.short_summary.trim());
  else if (a.summary) pieces.push(a.summary.trim().slice(0, 800));
  if (a.entities) {
    const e = a.entities;
    const tags: string[] = [];
    if (e.documentType) tags.push(`type=${e.documentType}`);
    if (e.parties?.length) {
      tags.push(
        `parties=${e.parties.slice(0, 6).map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join('; ')}`,
      );
    }
    if (e.dates?.length) {
      tags.push(
        `dates=${e.dates.slice(0, 6).map((d) => `${d.date}:${d.description ?? ''}`).join('; ')}`,
      );
    }
    if (e.deadlines?.length) {
      tags.push(
        `deadlines=${e.deadlines.slice(0, 4).map((d) => `${d.date}:${d.description ?? ''}`).join('; ')}`,
      );
    }
    if (tags.length) pieces.push(tags.join(' | '));
  }
  return pieces.join('\n');
}

// ── System prompts ───────────────────────────────────────────────────

function sharedPromptPrelude(firmCtx: string): string {
  return `${firmCtx}

You are a legal matter analyst. You produce maintained matter briefs from structured case data and analyzed document summaries.

Writing style:
- Professional, concise, suitable for practicing lawyers.
- Be specific: cite dates, names, docket numbers, filing types. Never hedge with "possibly" unless the source itself is ambiguous.
- Return ONLY valid JSON with no markdown fences, no preamble, no trailing commentary.
- All dates in ISO YYYY-MM-DD. If you cannot determine an exact date, omit the field rather than guess.
- Never fabricate. If a section has no evidence in the provided data, emit an empty string / empty array / null as the schema allows.

${DELIVERABLE_LIFECYCLE_NOTE}`;
}

function nonCaseSystemPrompt(firmCtx: string): string {
  return `${sharedPromptPrelude(firmCtx)}

The matter is NOT a case (no case title or case number). Produce a brief focused on what the firm is doing for this client. Return JSON with this schema:

{
  "summary": "A 3-6 sentence paragraph describing what this matter is, what the firm is doing, and its current state. Mention the client, the nature of the engagement, and any notable recent activity.",
  "latest_incident": "One sentence describing the most recent notable event (new deliverable, new document, milestone). Include the date. Null if nothing notable.",
  "latest_incident_date": "YYYY-MM-DD of the latest incident, or null.",
  "key_dates": [
    { "date": "YYYY-MM-DD", "label": "short description", "status": "upcoming" | "past" | "contingent", "source_ref": "optional source label or null" }
  ],
  "open_issues": [
    { "issue": "1-sentence issue that is unresolved or needs the firm's attention", "source_refs": ["source label"], "flagged_at": "YYYY-MM-DD or null" }
  ]
}

Rules:
- key_dates should capture real calendar events (deadlines, meetings, document due dates, renewal dates, scheduled reviews). Prefer dates drawn from the provided deliverables, hearings, or document entities. Do not invent dates.
- Cap key_dates at 15 entries — the most lawyer-consequential ones only. If you must choose, prefer upcoming deadlines and recent material events; collapse routine schedule changes into a single entry rather than listing each one.
- open_issues should be things a lawyer would track — pending drafts, unanswered requests, decisions owed by the client. Use null for flagged_at when unknown. Cap at 10 entries.
- Return {} only if the input is truly empty — otherwise always emit every schema field.`;
}

function caseSystemPrompt(firmCtx: string): string {
  return `${sharedPromptPrelude(firmCtx)}

The matter IS a case (has a case title and/or case number). Produce a full litigation brief. Return JSON with this schema:

{
  "summary": "A 4-8 sentence paragraph summarizing the case — parties, core dispute, current procedural posture, and recent activity.",
  "posture": "One or two sentences stating the current procedural stance. e.g. 'Awaiting ruling on Motion to Dismiss filed 2026-03-12.' Draw from the most recent ruling, filing, or hearing. If posture is unclear from the data, say so plainly.",
  "parties": [
    { "name": "Full name", "role": "e.g. petitioner, respondent, counsel for petitioner, judge", "side": "us" | "opposing" | "other", "notes": "optional, e.g. alias or affiliation" }
  ],
  "claims_and_defenses": [
    { "party": "name of party", "theory": "one sentence articulating the theory (cause of action, defense, or affirmative relief sought)", "source_refs": ["source label"] }
  ],
  "court_and_venue": "Court, branch, and judge if known, formatted as a single line. e.g. 'RTC Manila Branch 34, Judge J. dela Cruz'.",
  "key_dates": [
    { "date": "YYYY-MM-DD", "label": "short description", "status": "upcoming" | "past" | "contingent", "source_ref": "optional source label or null" }
  ],
  "key_rulings": [
    { "date": "YYYY-MM-DD", "ruling": "short description of the order/resolution", "effect": "one sentence on what this means for the case", "source_refs": ["source label"] }
  ],
  "open_issues": [
    { "issue": "1-sentence issue that is unresolved", "source_refs": ["source label"], "flagged_at": "YYYY-MM-DD or null" }
  ],
  "latest_incident": "One sentence describing the most recent notable event. Include date.",
  "latest_incident_date": "YYYY-MM-DD of latest incident, or null."
}

Rules:
- Always emit every schema field. Use [] for empty arrays, "" or null where the schema allows, never omit a key.
- parties: try to classify side. "us" = the firm represents this party. "opposing" = adverse party. "other" = judge, counsel for opposing, court personnel, witnesses, etc. If unclear, use "other". Cap at 15 named parties — include everyone material; collapse minor/redundant counsel listings.
- claims_and_defenses: include each side's theory at least once if evidence is present. Attribute to the party asserting it. Cap at 6 entries.
- key_rulings: orders/resolutions that CHANGED the state of the case (grants, denials, admissions, pre-trial orders, final judgments). Routine schedule-reset orders or procedural clerical orders do NOT belong here. Chronological ascending. Cap at 10 entries.
- key_dates: the most lawyer-consequential dates — upcoming deadlines, material rulings, dispositive filings, hearings that changed the case. Cap at 20 entries. Do not list every hearing on the calendar; collapse a string of routine schedulings into a single "Presentation of evidence hearings, YYYY-MM through YYYY-MM" entry.
- open_issues: genuinely unresolved items that need attention. Cap at 8 entries.
- Draw court_and_venue from the matter's "Court" field first, then from document JURISDICTION tags as a fallback.`;
}

// ── JSON parsing ─────────────────────────────────────────────────────
//
// Claude occasionally emits JSON that:
//   - Is wrapped in a ``` fence (despite the prompt saying not to).
//   - Has an unescaped quote inside a description string (malformed).
//   - Is truncated mid-string because we hit max_tokens.
//
// We try strict JSON.parse first; on failure we progressively recover —
// find the outermost {...} block, close unterminated strings/arrays, and
// parse the salvageable prefix. Returning partial data beats failing the
// entire brief for the 1-3 pathological matters.

function parseBriefJson(raw: string, matterId: string): Record<string, unknown> {
  const cleaned = stripFence(raw.trim());

  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    // Try to recover.
    try {
      const recovered = recoverTruncatedJson(cleaned);
      const parsed = JSON.parse(recovered);
      console.warn(`[matter-brief] Recovered partial JSON for ${matterId}: ${e1 instanceof Error ? e1.message : e1}`);
      return parsed;
    } catch (e2) {
      console.error(`[matter-brief] JSON parse failed for ${matterId}:`, e1 instanceof Error ? e1.message : e1);
      console.error(`[matter-brief] Recovery also failed:`, e2 instanceof Error ? e2.message : e2);
      throw e1;
    }
  }
}

function stripFence(s: string): string {
  if (!s.startsWith('```')) return s;
  return s.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
}

/**
 * Attempt to close a truncated JSON object so JSON.parse can succeed.
 * Strategy:
 *   1. Walk the text tracking string/array/object state.
 *   2. When we hit the end prematurely, close any open string, then close
 *      open arrays / objects in reverse nesting order.
 * This produces a best-effort-valid prefix; the fields populated up to the
 * truncation point survive, the rest become empty arrays / null.
 */
function recoverTruncatedJson(s: string): string {
  let inString = false;
  let escape = false;
  const stack: Array<'{' | '['> = [];
  let lastCompletePos = -1;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = false; continue; }
      continue;
    }

    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') { stack.push(c); continue; }
    if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length === 0) lastCompletePos = i; // a complete top-level JSON ended here
      continue;
    }
  }

  // If we closed cleanly at some point, prefer that prefix.
  if (lastCompletePos >= 0 && stack.length === 0 && !inString) {
    return s.slice(0, lastCompletePos + 1);
  }

  // Otherwise build a recovery suffix.
  let suffix = '';
  if (inString) suffix += '"';

  // Trim any dangling ", " or ":" left after an incomplete value, then close
  // each open container in reverse.
  let prefix = s;
  // Drop a trailing incomplete key/value pair like ,\n  "foo": or ,\n  "foo": "unfinished
  prefix = prefix.replace(/,\s*"[^"]*"?\s*:\s*[^,}\]]*$/, '');
  prefix = prefix.replace(/,\s*"[^"]*$/, '');
  prefix = prefix.replace(/,\s*$/, '');

  for (let i = stack.length - 1; i >= 0; i--) {
    suffix += stack[i] === '{' ? '}' : ']';
  }

  return prefix + suffix;
}
