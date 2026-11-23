// ── Matter Group Brief Generator ─────────────────────────────────────
//
// Produces a single AI brief that spans every matter in a connected
// component (group). Unlike the per-matter brief, this one emphasizes
// progression — the preliminary investigation → trial case → appeal
// arc — and consolidates parties / rulings / open issues across the
// related matters so a lawyer opening the group page gets one
// coherent picture instead of N separate briefs.
//
// Input context: each member matter's metadata, its cached
// matter_summaries row (reused as ground truth), and high-signal
// deliverables/hearings/filings/files from the whole set.

import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import { manilaToday, toManilaDay } from '@/lib/dates';

const MODEL = 'claude-haiku-4-5-20251001';

type Sb = SupabaseClient;

// ── Types ────────────────────────────────────────────────────────────

export interface GroupPartyEntry {
  name: string;
  role: string;
  side?: 'us' | 'opposing' | 'other';
  notes?: string;
  source_matter_ids?: string[];
}

export interface GroupKeyDate {
  date: string;
  label: string;
  status?: 'upcoming' | 'past' | 'contingent';
  source_matter_id?: string | null;
}

export interface GroupRuling {
  date: string;
  ruling: string;
  effect: string;
  source_matter_id?: string | null;
}

export interface GroupOpenIssue {
  issue: string;
  source_matter_ids?: string[];
  flagged_at?: string | null;
}

export interface GroupBriefResult {
  summary: string;
  posture: string | null;
  progression_notes: string | null;
  parties: GroupPartyEntry[];
  key_dates: GroupKeyDate[];
  key_rulings: GroupRuling[];
  open_issues: GroupOpenIssue[];
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export interface GroupContext {
  firmId: string;
  root_matter_id: string;
  member_matter_ids: string[];
}

// ── Public entry point ───────────────────────────────────────────────

export async function generateGroupBrief(ctx: GroupContext): Promise<GroupBriefResult> {
  const supabase = getServiceDbForFirm(ctx.firmId);

  const [members, perMatterSummaries, deliverables, hearings, files, firmCtx] = await Promise.all([
    fetchMembers(supabase, ctx.member_matter_ids),
    fetchPerMatterSummaries(supabase, ctx.member_matter_ids),
    fetchDeliverables(supabase, ctx.member_matter_ids),
    fetchHearings(supabase, ctx.member_matter_ids),
    fetchFiles(supabase, ctx.member_matter_ids),
    loadFirmPromptContext(ctx.firmId),
  ]);

  if (members.length === 0) {
    throw new Error(`No member matters found for group ${ctx.root_matter_id}`);
  }

  const userMessage = buildUserMessage(members, perMatterSummaries, deliverables, hearings, files);

  const claude = await anthropicFor({ firmId: ctx.firmId, feature: 'ai_analysis' });

  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 16384,
    system: groupBriefSystemPrompt(firmCtx),
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  const parsed = parseBriefJson(content.text, ctx.root_matter_id);
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

  return {
    summary: String(parsed.summary ?? '').trim(),
    posture: str(parsed.posture),
    progression_notes: str(parsed.progression_notes),
    parties: Array.isArray(parsed.parties) ? (parsed.parties as GroupPartyEntry[]) : [],
    key_dates: Array.isArray(parsed.key_dates) ? (parsed.key_dates as GroupKeyDate[]) : [],
    key_rulings: Array.isArray(parsed.key_rulings) ? (parsed.key_rulings as GroupRuling[]) : [],
    open_issues: Array.isArray(parsed.open_issues) ? (parsed.open_issues as GroupOpenIssue[]) : [],
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    model: MODEL,
  };
}

// ── Data fetching ────────────────────────────────────────────────────

interface MemberRow {
  notion_id: string;
  name: string;
  matter_code: string | null;
  client_name: string | null;
  type: string | null;
  status: string | null;
  case_title: string | null;
  case_number: string | null;
  court: string | null;
  case_description: string | null;
  outcome: string | null;
  parent_matter_id: string | null;
  is_case: boolean | null;
}

async function fetchMembers(sb: Sb, ids: string[]): Promise<MemberRow[]> {
  if (ids.length === 0) return [];
  const { data } = await sb
    .from('matters')
    .select('notion_id, name, matter_code, client_name, type, status, case_title, case_number, court, case_description, outcome, parent_matter_id, is_case')
    .in('notion_id', ids);
  return (data ?? []) as MemberRow[];
}

interface PerMatterSummary {
  matter_id: string;
  summary: string | null;
  posture: string | null;
  latest_incident: string | null;
  latest_incident_date: string | null;
  parties: unknown;
  key_rulings: unknown;
  key_dates: unknown;
  open_issues: unknown;
}

async function fetchPerMatterSummaries(sb: Sb, ids: string[]): Promise<PerMatterSummary[]> {
  if (ids.length === 0) return [];
  const { data } = await sb
    .from('matter_summaries')
    .select('matter_id, summary, posture, latest_incident, latest_incident_date, parties, key_rulings, key_dates, open_issues')
    .in('matter_id', ids);
  return (data ?? []) as PerMatterSummary[];
}

async function fetchDeliverables(sb: Sb, ids: string[]) {
  if (ids.length === 0) return [];
  const { data } = await sb
    .from('deliverables')
    .select('matter_id, name, type, status, external_due_date, date_done')
    .in('matter_id', ids)
    .order('date_done', { ascending: false, nullsFirst: false })
    .limit(80);
  return data ?? [];
}

async function fetchHearings(sb: Sb, ids: string[]) {
  if (ids.length === 0) return [];
  const { data } = await sb
    .from('hearings')
    .select('matter_id, name, date, status, type')
    .in('matter_id', ids)
    .order('date', { ascending: false, nullsFirst: false })
    .limit(60);
  return data ?? [];
}

async function fetchFiles(sb: Sb, ids: string[]) {
  if (ids.length === 0) return [];
  const { data } = await sb
    .from('files')
    .select('matter_id, notion_id, name, date_received, origin, action_taken, is_court_record')
    .in('matter_id', ids)
    .order('date_received', { ascending: false, nullsFirst: false })
    .limit(60);
  return data ?? [];
}

// ── Prompt assembly ──────────────────────────────────────────────────

function buildUserMessage(
  members: MemberRow[],
  perMatterSummaries: PerMatterSummary[],
  deliverables: Array<{ matter_id: string; name: string; type: string | null; status: string; external_due_date: string | null; date_done: string | null }>,
  hearings: Array<{ matter_id: string; name: string; date: string | null; status: string | null; type: string | null }>,
  files: Array<{ matter_id: string; notion_id: string; name: string; date_received: string | null; origin: string | null; action_taken: string | null; is_court_record: boolean | null }>,
): string {
  const today = manilaToday();
  const lines: string[] = [];

  lines.push(`TODAY: ${today} (classify dates as past / upcoming based on this).`);
  lines.push('');

  // Index members for chain discussion.
  const byId = new Map(members.map((m) => [m.notion_id, m]));
  const sortedMembers = [...members].sort((a, b) => (a.matter_code ?? '').localeCompare(b.matter_code ?? ''));

  lines.push('--- MATTERS IN THIS GROUP ---');
  for (const m of sortedMembers) {
    const bits = [`ID=${m.notion_id}`];
    bits.push(`name=${m.name}`);
    if (m.matter_code) bits.push(`code=${m.matter_code}`);
    if (m.type) bits.push(`type=${m.type}`);
    if (m.status) bits.push(`status=${m.status}`);
    if (m.client_name) bits.push(`client=${m.client_name}`);
    if (m.case_title) bits.push(`case_title=${m.case_title}`);
    if (m.case_number) bits.push(`case_number=${m.case_number}`);
    if (m.court) bits.push(`court=${m.court}`);
    if (m.outcome) bits.push(`outcome=${m.outcome}`);
    if (m.parent_matter_id) {
      const parent = byId.get(m.parent_matter_id);
      bits.push(`parent=${parent?.name ?? m.parent_matter_id}`);
    }
    lines.push(`- ${bits.join(' | ')}`);
    if (m.case_description) lines.push(`  description: ${m.case_description.slice(0, 400)}`);
  }

  if (perMatterSummaries.length) {
    lines.push('\n--- PER-MATTER BRIEFS (use as ground truth, synthesize don\'t repeat) ---');
    const summaryMap = new Map(perMatterSummaries.map((s) => [s.matter_id, s]));
    for (const m of sortedMembers) {
      const s = summaryMap.get(m.notion_id);
      if (!s) continue;
      lines.push(`\n[${m.name} — ${m.matter_code ?? m.notion_id}]`);
      if (s.summary) lines.push(`summary: ${s.summary}`);
      if (s.posture) lines.push(`posture: ${s.posture}`);
      if (s.latest_incident) {
        lines.push(`latest_incident${s.latest_incident_date ? ` (${s.latest_incident_date})` : ''}: ${s.latest_incident}`);
      }
      if (Array.isArray(s.parties) && s.parties.length) lines.push(`parties: ${JSON.stringify(s.parties)}`);
      if (Array.isArray(s.key_rulings) && s.key_rulings.length) lines.push(`key_rulings: ${JSON.stringify(s.key_rulings)}`);
      if (Array.isArray(s.key_dates) && s.key_dates.length) lines.push(`key_dates: ${JSON.stringify(s.key_dates)}`);
      if (Array.isArray(s.open_issues) && s.open_issues.length) lines.push(`open_issues: ${JSON.stringify(s.open_issues)}`);
    }
  }

  if (deliverables.length) {
    lines.push('\n--- DELIVERABLES (across all member matters) ---');
    for (const d of deliverables.slice(0, 60)) {
      const parent = byId.get(d.matter_id);
      const bits = [`matter=${parent?.matter_code ?? d.matter_id}`, `name=${d.name}`, `status=${d.status}`];
      if (d.type) bits.push(`type=${d.type}`);
      if (d.external_due_date) bits.push(`due=${d.external_due_date}`);
      if (d.date_done) bits.push(`done=${d.date_done}`);
      lines.push(`- ${bits.join(' | ')}`);
    }
  }

  if (hearings.length) {
    lines.push('\n--- HEARINGS ---');
    for (const h of hearings.slice(0, 40)) {
      const parent = byId.get(h.matter_id);
      const bits = [`matter=${parent?.matter_code ?? h.matter_id}`, `name=${h.name}`];
      if (h.date) bits.push(`date=${toManilaDay(String(h.date))}`);
      if (h.status) bits.push(`status=${h.status}`);
      if (h.type) bits.push(`type=${h.type}`);
      lines.push(`- ${bits.join(' | ')}`);
    }
  }

  if (files.length) {
    lines.push('\n--- SELECT FILES ---');
    for (const f of files.slice(0, 40)) {
      const parent = byId.get(f.matter_id);
      const bits = [`matter=${parent?.matter_code ?? f.matter_id}`, `name=${f.name}`];
      if (f.origin) bits.push(`origin=${f.origin}`);
      if (f.is_court_record) bits.push('COURT_RECORD');
      if (f.date_received) bits.push(`received=${f.date_received}`);
      lines.push(`- ${bits.join(' | ')}`);
    }
  }

  lines.push('\nProduce the group brief as JSON per the schema.');
  return lines.join('\n');
}

// ── System prompt ────────────────────────────────────────────────────

function groupBriefSystemPrompt(firmCtx: string): string {
  return `${firmCtx}

You are a legal analyst. You produce a unified brief spanning a GROUP of related matters — typically a single dispute that moved through stages (preliminary investigation, trial, appeal), or a cluster of matters arising from one underlying controversy.

Your job is not to repeat each per-matter brief. Your job is to weave them into a single narrative: how the matters are related, how the controversy progressed across them, what rulings or events at one stage affected the others, and what the firm needs to watch across the whole group.

Return ONLY valid JSON in this exact schema — no markdown fences, no preamble:

{
  "summary": "3-6 sentences. What the underlying dispute is, who the parties are, and how the member matters fit together as a progression or as parallel fronts. Emphasize the RELATIONSHIP between matters — not each one individually.",
  "posture": "One or two sentences on where the whole group stands today. E.g. 'Criminal case is in trial before RTC Manila; related civil case is awaiting ruling on MTD; appeal from preliminary investigation ruling is pending at DOJ.' Null if all matters are closed.",
  "progression_notes": "One paragraph describing the chain/flow of matters — e.g. 'Matter A (preliminary investigation at OCP) produced a prosecutor's resolution that led to Matter B (Information filed with RTC). Matter C is a related civil action arising from the same facts.' Null only if matters are parallel and there is no meaningful progression.",
  "parties": [
    { "name": "Full name", "role": "e.g. petitioner / respondent / complainant", "side": "us" | "opposing" | "other", "notes": "optional", "source_matter_ids": ["notion_id", ...] }
  ],
  "key_dates": [
    { "date": "YYYY-MM-DD", "label": "short event description", "status": "upcoming" | "past" | "contingent", "source_matter_id": "notion_id or null" }
  ],
  "key_rulings": [
    { "date": "YYYY-MM-DD", "ruling": "what was ordered", "effect": "what this means going forward, including cross-matter impact", "source_matter_id": "notion_id or null" }
  ],
  "open_issues": [
    { "issue": "one-sentence unresolved item requiring firm action", "source_matter_ids": ["notion_id", ...], "flagged_at": "YYYY-MM-DD or null" }
  ]
}

Rules:
- Always emit every schema field. Use [] for empty arrays, "" / null where allowed.
- Dates are YYYY-MM-DD. Omit rather than guess.
- parties: dedupe — a party that appears in multiple matters should be listed ONCE with all source_matter_ids listed. Cap at 15.
- key_dates: cross-matter calendar — upcoming deadlines/hearings that matter to the group. Cap at 20. Collapse routine schedulings.
- key_rulings: state-changing orders from any member matter. Highlight cross-matter effects (e.g. "dismissal of preliminary investigation mooted the related bail application"). Cap at 10.
- open_issues: things a lawyer needs to act on. If one issue spans multiple matters, list all source_matter_ids. Cap at 8.
- Tone: neutral, concrete, lawyer-to-lawyer. No speculation.`;
}

// ── JSON parsing ─────────────────────────────────────────────────────

function parseBriefJson(raw: string, rootId: string): Record<string, unknown> {
  let text = raw.trim();
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`[group-brief] JSON parse failed for group ${rootId}:`, e instanceof Error ? e.message : e);
    throw e;
  }
}
