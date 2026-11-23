// ── Ad-hoc Status Report Generator ──────────────────────────────────
//
// Aggregates activity on a matter since the last Status Report (or since
// matter creation if there's been none), and drafts a client-facing letter
// covering what's happened. Includes a short recap preamble if the gap
// since the last report is long (>= 90 days).
//
// Different from the per-filing status report (lib/ai/claude.ts
// draftStatusReport): that generator reads a single filing document and
// writes about it. This one doesn't read raw docs — it reads summaries
// and entities we've already analyzed, plus structured event data from
// the matter (hearings, filings, incoming court records).

import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { assembleDraftGrounding, type DraftGrounding } from '@/lib/ai/draft-grounding';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import { responseText } from '@/lib/ai/response-text';
import type { StatusReportDraft } from '@/lib/ai/claude';
import type { AnalysisEntities } from '@/types/ai';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { manilaDayEnd, manilaToday, toManilaDay, utcCalendarDay } from '@/lib/dates';

// Status reports are drafted through the same engine + grounding as the rest of
// the Drafting Studio so they read like the firm's own work, not a weaker
// template. 'standard' = Sonnet 5 (everyday), 'complex' = Opus 4.8.
const STATUS_REPORT_MODELS = {
  standard: 'claude-sonnet-5',
  complex: 'claude-opus-4-8',
} as const;
const RECAP_GAP_DAYS = 90;

// ── Types ────────────────────────────────────────────────────────────

export interface AdhocStatusReportInput {
  firmId: string;
  matterId: string;
  /** If omitted, defaults to the last Status Report's date_done or the matter's created_time. */
  sinceDate?: string;
  /** Drafting model tier. 'standard' → Sonnet 5, 'complex' → Opus 4.8. Defaults to 'standard'. */
  model?: 'standard' | 'complex';
  /** Free-text steer from the drafter (tone, emphasis, specific asks). */
  instructions?: string;
  /**
   * Pre-assembled grounding — required so the includeAuthorities policy for
   * status reports lives in one place (composeStatusReport). A convenience
   * fallback here previously re-assembled grounding WITH authorities,
   * contradicting that policy for any future direct caller.
   */
  grounding: DraftGrounding;
}

export interface AdhocStatusReportResult extends StatusReportDraft {
  sinceDate: string;       // actual cutoff used
  includedRecap: boolean;  // true if the recap preamble was requested
  eventCount: number;      // total events folded in
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface Event {
  date: string;            // YYYY-MM-DD
  kind: 'hearing' | 'filing' | 'incoming_doc' | 'ruling';
  label: string;
  summary: string;
  sourceRef: string;       // for debugging / future UI
}

// ── Public entry point ───────────────────────────────────────────────

export async function generateAdhocStatusReport(input: AdhocStatusReportInput): Promise<AdhocStatusReportResult> {
  const supabase = getServiceDbForFirm(input.firmId);

  // Load matter + client.
  const { data: matter, error: mErr } = await supabase
    .from('matters')
    .select('notion_id, name, case_title, case_number, court, client_name, client_id, created_time, case_description')
    .eq('notion_id', input.matterId)
    .single();
  if (mErr || !matter) throw new Error('Matter not found');

  let clientDetails: {
    name?: string | null;
    full_company_name?: string | null;
    contact_email?: string | null;
    point_persons?: string | string[] | null;
  } | null = null;
  if (matter.client_id) {
    const { data: c } = await supabase
      .from('clients')
      .select('name, full_company_name, contact_email, point_persons')
      .eq('notion_id', matter.client_id)
      .maybeSingle();
    clientDetails = c;
  }

  // Resolve cutoff date: last sent status report's date_done, else matter creation.
  let sinceDate = input.sinceDate;
  if (!sinceDate) {
    const { data: lastReport } = await supabase
      .from('deliverables')
      .select('date_done')
      .eq('matter_id', input.matterId)
      .eq('type', 'Status Report')
      .in('status', [DELIVERABLE_STATUS.FILED_OR_SENT_OUT, DELIVERABLE_STATUS.ARCHIVED])
      .not('date_done', 'is', null)
      .order('date_done', { ascending: false })
      .limit(1)
      .maybeSingle();
    sinceDate = lastReport?.date_done ?? (matter.created_time ? toManilaDay(matter.created_time) : null);
  }
  if (!sinceDate) sinceDate = utcCalendarDay(new Date(0));

  // Did we ever have a prior status report? Decides whether "recap" is relevant at all.
  const { data: priorCount } = await supabase
    .from('deliverables')
    .select('notion_id', { count: 'exact', head: false })
    .eq('matter_id', input.matterId)
    .eq('type', 'Status Report')
    .not('date_done', 'is', null)
    .limit(1);
  const hasPriorReport = (priorCount?.length ?? 0) > 0;

  const gapDays = Math.floor((Date.now() - new Date(sinceDate).getTime()) / 86_400_000);
  const includeRecap = hasPriorReport && gapDays >= RECAP_GAP_DAYS;

  const events = await fetchEvents(supabase, input.matterId, sinceDate);

  // Ground the report in the firm's own prior status reports + client-facing
  // work (and any matching KMS pages), so it reads in the firm's house style rather
  // than a generic template. Same grounding engine as the rest of the Studio.
  const grounding = input.grounding;

  const claude = await anthropicFor({ firmId: input.firmId, feature: 'ai_analysis' });
  const model = STATUS_REPORT_MODELS[input.model ?? 'standard'];

  const userMessage = buildUserMessage(
    {
      name: matter.name,
      caseTitle: matter.case_title,
      caseNumber: matter.case_number,
      court: matter.court,
      clientName: matter.client_name,
      caseDescription: matter.case_description,
    },
    clientDetails,
    sinceDate,
    includeRecap,
    events,
    grounding.promptBlock,
    input.instructions,
  );

  // The standard tier thinks adaptively by default; the cap has to leave room
  // for the reasoning as well as the letter.
  const response = await claude.messages.create({
    model,
    max_tokens: 16000,
    system: buildSystemPrompt(await loadFirmPromptContext(input.firmId), includeRecap),
    messages: [{ role: 'user', content: userMessage }],
  });

  let jsonText = responseText(response).trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const parsed = JSON.parse(jsonText);

  return {
    addressee: {
      name: parsed.addressee?.name ?? matter.client_name ?? 'Valued Client',
      address: parsed.addressee?.address ?? null,
      email: parsed.addressee?.email ?? clientDetails?.contact_email ?? null,
      throughName: parsed.addressee?.throughName ?? null,
      throughTitle: parsed.addressee?.throughTitle ?? null,
    },
    salutation: parsed.salutation ?? 'Dear Sir/Madam:',
    reLines: parsed.reLines ?? [matter.case_title, matter.case_number, matter.court].filter(Boolean).join('\n'),
    bodyParagraphs: parsed.bodyParagraphs ?? [],
    annexes: parsed.annexes ?? [],
    sinceDate,
    includedRecap: includeRecap,
    eventCount: events.length,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model,
  };
}

// ── Event gathering ──────────────────────────────────────────────────

type Sb = SupabaseClient;

async function fetchEvents(sb: Sb, matterId: string, sinceDate: string): Promise<Event[]> {
  const events: Event[] = [];

  // Attended hearings in window
  const { data: hearings } = await sb
    .from('hearings')
    .select('notion_id, name, date, type, is_attended, status')
    .eq('matter_id', matterId)
    .eq('is_attended', true)
    .gt('date', manilaDayEnd(sinceDate));
  for (const h of hearings ?? []) {
    events.push({
      date: toManilaDay(String(h.date)),
      kind: 'hearing',
      label: h.name || 'Hearing',
      summary: h.type ? `Hearing (${h.type}) — ${h.status ?? 'attended'}` : (h.status ?? 'Attended'),
      sourceRef: `hearing:${h.notion_id}`,
    });
  }

  // Filings sent / filed in window (deliverables of type External/Filing with date_done > sinceDate)
  const { data: filings } = await sb
    .from('deliverables')
    .select('notion_id, name, type, status, date_done')
    .eq('matter_id', matterId)
    .in('type', ['External', 'Filing'])
    .eq('status', DELIVERABLE_STATUS.FILED_OR_SENT_OUT)
    .gt('date_done', sinceDate);

  // Fold in per-filing analyses (from deliverable_files analyses) when available so the
  // summary reflects what we actually filed, not just the deliverable name.
  const filingIds = (filings ?? []).map((f) => f.notion_id);
  let versionAnalyses: Array<{ deliverable_id: string; summary: string | null; short_summary: string | null }> = [];
  if (filingIds.length) {
    const { data: versions } = await sb
      .from('deliverable_files')
      .select('id, deliverable_id')
      .in('deliverable_id', filingIds);
    const vIds = (versions ?? []).map((v) => v.id);
    if (vIds.length) {
      const { data: analyses } = await sb
        .from('file_analyses')
        .select('deliverable_file_id, summary, short_summary')
        .in('deliverable_file_id', vIds)
        .eq('status', 'completed');
      const vToDeliv = new Map((versions ?? []).map((v) => [v.id, v.deliverable_id]));
      for (const a of analyses ?? []) {
        const dId = vToDeliv.get(a.deliverable_file_id!);
        if (dId) versionAnalyses.push({
          deliverable_id: dId,
          summary: a.summary,
          short_summary: a.short_summary,
        });
      }
    }
  }

  for (const f of filings ?? []) {
    const analysis = versionAnalyses.find((a) => a.deliverable_id === f.notion_id);
    events.push({
      date: String(f.date_done).slice(0, 10),
      kind: 'filing',
      label: f.name || 'Filing',
      summary: analysis?.short_summary ?? analysis?.summary?.slice(0, 500) ?? `Filed ${f.date_done}`,
      sourceRef: `deliverable:${f.notion_id}`,
    });
  }

  // Incoming docs / court records in window
  const { data: files } = await sb
    .from('files')
    .select('notion_id, name, date_received, date_sent_filed, document_date, origin, is_court_record')
    .eq('matter_id', matterId)
    .gt('date_received', sinceDate);

  // Pull their analyses for richer summaries
  const fileIds = (files ?? []).map((f) => f.notion_id);
  let fileAnalyses: Array<{ file_id: string; summary: string | null; short_summary: string | null; entities: Partial<AnalysisEntities> | null }> = [];
  if (fileIds.length) {
    const { data: analyses } = await sb
      .from('file_analyses')
      .select('file_id, summary, short_summary, entities')
      .in('file_id', fileIds)
      .eq('status', 'completed');
    fileAnalyses = (analyses ?? []).map((a) => ({
      file_id: a.file_id,
      summary: a.summary,
      short_summary: a.short_summary,
      entities: a.entities as Partial<AnalysisEntities> | null,
    }));
  }

  for (const f of files ?? []) {
    const a = fileAnalyses.find((x) => x.file_id === f.notion_id);
    const docType = (a?.entities?.documentType ?? '').toLowerCase();
    const isRuling = f.is_court_record && /(order|resolution|ruling|judgment|decision)/.test(docType);
    events.push({
      date: String(f.date_received).slice(0, 10),
      kind: isRuling ? 'ruling' : 'incoming_doc',
      label: f.name || 'Document received',
      summary: a?.short_summary ?? a?.summary?.slice(0, 500) ?? `Received ${f.origin ?? ''}`.trim(),
      sourceRef: `file:${f.notion_id}`,
    });
  }

  // Chronological ascending
  events.sort((x, y) => x.date.localeCompare(y.date));
  return events;
}

// ── Prompt assembly ──────────────────────────────────────────────────

function buildUserMessage(
  matter: {
    name: string;
    caseTitle: string | null;
    caseNumber: string | null;
    court: string | null;
    clientName: string | null;
    caseDescription: string | null;
  },
  client: {
    name?: string | null;
    full_company_name?: string | null;
    contact_email?: string | null;
    point_persons?: string | string[] | null;
  } | null,
  sinceDate: string,
  includeRecap: boolean,
  events: Event[],
  groundingBlock?: string,
  instructions?: string,
): string {
  const today = manilaToday();
  const pointPersons = Array.isArray(client?.point_persons)
    ? client.point_persons
    : client?.point_persons
      ? [client.point_persons]
      : [];

  const lines: string[] = [];

  lines.push(`TODAY: ${today}`);
  lines.push(`SINCE DATE (last update to client): ${sinceDate}`);
  lines.push(`INCLUDE RECAP: ${includeRecap ? 'YES' : 'NO'}`);
  lines.push('');

  lines.push('--- MATTER ---');
  lines.push(`Matter Name: ${matter.name}`);
  if (matter.caseTitle) lines.push(`Case Title: ${matter.caseTitle}`);
  if (matter.caseNumber) lines.push(`Case/Docket Number: ${matter.caseNumber}`);
  if (matter.court) lines.push(`Court/Tribunal: ${matter.court}`);
  if (matter.clientName) lines.push(`Client: ${matter.clientName}`);
  if (matter.caseDescription) lines.push(`Case Description: ${matter.caseDescription}`);

  lines.push('');
  lines.push('--- CLIENT DETAILS ---');
  if (client?.full_company_name) lines.push(`Company Name: ${client.full_company_name}`);
  if (client?.name) lines.push(`Client Short Name: ${client.name}`);
  if (client?.contact_email) lines.push(`Contact Email: ${client.contact_email}`);
  if (pointPersons.length) lines.push(`Point Persons: ${pointPersons.join(', ')}`);

  lines.push('');
  if (events.length === 0) {
    lines.push('--- EVENTS SINCE LAST UPDATE ---');
    lines.push('(none — if recap is not requested, acknowledge that nothing material has happened and confirm the matter is on track)');
  } else {
    lines.push(`--- EVENTS SINCE ${sinceDate} (${events.length} total, chronological) ---`);
    for (const e of events) {
      lines.push(`[${e.date}] ${e.kind.toUpperCase()} — ${e.label}`);
      if (e.summary) lines.push(`  ${e.summary.replace(/\n+/g, ' ').slice(0, 500)}`);
    }
  }

  if (groundingBlock && groundingBlock.trim().length > 0) {
    lines.push('');
    lines.push('--- FIRM GROUNDING (write in this house style; reuse structure and phrasing, never copy another matter\'s specific facts) ---');
    lines.push(groundingBlock);
  }

  if (instructions && instructions.trim().length > 0) {
    lines.push('');
    lines.push('--- ADDITIONAL INSTRUCTIONS FROM THE DRAFTER ---');
    lines.push(instructions.trim());
  }

  lines.push('');
  lines.push('Draft the status report letter as JSON per the schema.');
  return lines.join('\n');
}

// ── System prompt ────────────────────────────────────────────────────

function buildSystemPrompt(firmCtx: string, includeRecap: boolean): string {
  return `${firmCtx}

You are a legal writer. Draft a periodic status report letter to a client aggregating what's happened on their matter since the last update.

Style guidelines:
- Formal, professional Philippine legal English. Respectful, client-focused, clear.
- Reference case details precisely (case/docket number, court, parties, dates).
- Refer to the firm as "we" or "the Firm".
- Body paragraphs should walk the client through what happened in chronological order. Each event should be explained in one or two sentences with legal significance. Group related events if it aids clarity (e.g., a filing + the subsequent order on it).
- Close with next steps or what the client can expect going forward.
- Do NOT include greetings/closings/signatures — only body paragraphs.

${includeRecap ? `IMPORTANT — INCLUDE A RECAP:
The gap since the last update is long (>= 90 days). Begin the body with ONE paragraph that briefly recaps the matter's current posture so the client doesn't need to dig up old correspondence. Then transition into "Since our last update on <sinceDate>, the following has taken place:" and cover the events.
` : `Begin naturally with "Since our last update on <sinceDate>," — no recap paragraph. The client remembers the context.
`}
Return ONLY valid JSON with this structure:
{
  "addressee": {
    "name": "Full name or company name of the recipient",
    "address": "Mailing address if available, or null",
    "email": "Email if available, or null",
    "throughName": "Name of contact person if sending through a representative, or null",
    "throughTitle": "Title/position of the through person, or null"
  },
  "salutation": "Dear [appropriate title and name]:",
  "reLines": "Case title\\nDocket/Case number\\nCourt/Tribunal\\nFor: [nature of case]",
  "bodyParagraphs": ["paragraph 1...", "paragraph 2...", "..."],
  "annexes": [{"letter": "A", "description": "Copy of the Order dated ..."}]
}

Rules:
- Return ONLY valid JSON, no markdown fences or extra text.
- annexes: include only when a specific document (order, resolution, filing) is referenced in the body AND would typically be attached. Use letters A, B, C in order of first reference.
- reLines: newline-separated. Include case title, docket number, court, and a short "For:" line.
- Salutation: use the point person's title + last name if provided (e.g., "Dear Ms. Santos:"). Otherwise "Dear Sir/Madam:".
- Never invent events or facts. If the event list is empty AND no recap is needed, write a brief courtesy paragraph noting no material developments and the expected next milestone.`;
}
