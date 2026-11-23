import type Anthropic from '@anthropic-ai/sdk';
import { anthropicFor, anthropicForPlatform, type AiContext } from '@/lib/ai/gate';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import type { AnalysisEntities } from '@/types/ai';
import { parseJsonResponse } from '@/lib/ai/json-response';
import { toManilaDay } from '@/lib/dates';

/**
 * Every export here takes an `AiContext` because this module is shared: the
 * same `uploadToClaudeFiles` serves file analysis, red team, affidavit review
 * and template updates, which are four separate consents. A module-level
 * client memoised across firms is what made that impossible to express, so it
 * is gone — `anthropicFor` resolves the feature per call, and `resolveFeature`
 * is React-cached per request, so the repeated ask is a map lookup.
 */

/**
 * Retry a function on 429 rate limit errors with exponential backoff.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const is429 = err instanceof Error && (
        err.message.includes('429') || err.message.includes('rate_limit')
      );
      if (!is429 || attempt === maxRetries) throw err;
      const waitMs = Math.min(60_000, (2 ** attempt) * 15_000);
      console.log(`[claude] Rate limited, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw new Error('Unreachable');
}

const SYSTEM_PROMPT = `You are a legal document analyst for a Philippine law firm. Analyze the provided document and return a JSON object with the following structure:

{
  "shortSummary": "A 1-2 sentence tl;dr of the document for quick inbox display. Be specific — mention the document type, key parties, and what action it requires or announces.",
  "summary": "A 2-3 paragraph plain-text summary of the document. Focus on the key facts, legal issues, and practical implications. Write in clear, professional language suitable for a practicing lawyer.",
  "entities": {
    "parties": [{ "name": "Full name", "role": "plaintiff|defendant|petitioner|respondent|counsel|judge|witness|other" }],
    "dates": [{ "date": "YYYY-MM-DD", "description": "What this date refers to" }],
    "deadlines": [{ "date": "YYYY-MM-DD", "description": "What is due or required by this date" }],
    "obligations": [{ "party": "Name of obligated party", "description": "What they must do" }],
    "caseReferences": ["Case titles and docket numbers, e.g. G.R. No. 12345, Civil Case No. 67890"],
    "documentType": "motion|order|resolution|decision|contract|affidavit|complaint|answer|reply|memorandum|letter|notice|subpoena|certificate|report|other",
    "jurisdiction": "The court or tribunal name, if identifiable"
  }
}

Rules:
- Return ONLY valid JSON, no markdown fences or extra text.
- If a field has no relevant data, use an empty array [] or empty string "".
- For dates, use ISO format YYYY-MM-DD. If only month/year is known, use the first of the month.
- For Philippine-specific legal references, include the full citation format.
- Be thorough in identifying all parties mentioned, even those referenced indirectly.`;

export interface AnalysisResult {
  shortSummary: string;
  summary: string;
  entities: AnalysisEntities;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

const MODEL = 'claude-haiku-4-5';

// ── Files API helpers ────────────────────────────────────────────

const MAX_FILE_SIZE = 32 * 1024 * 1024; // 32MB — Claude Files API limit

/**
 * Upload a file buffer to Claude's Files API (beta).
 * Returns the file_id for use in messages.
 */
export async function uploadToClaudeFiles(
  ctx: AiContext,
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Maximum is 32MB for Claude Files API.`,
    );
  }

  const claude = await anthropicFor(ctx);

  const file = new File([new Uint8Array(buffer)], fileName, {
    type: getMimeType(fileName),
  });

  const result = await claude.beta.files.upload({
    file,
    betas: ['files-api-2025-04-14'],
  });

  return result.id;
}

async function deleteWith(claude: Anthropic, fileId: string): Promise<void> {
  try {
    await claude.beta.files.delete(fileId, {
      betas: ['files-api-2025-04-14'],
    });
  } catch {
    // Ignore — file may already be expired/deleted
  }
}

/**
 * Delete a file a firm's own work put there.
 */
export async function deleteClaudeFile(ctx: AiContext, fileId: string): Promise<void> {
  await deleteWith(await anthropicFor(ctx), fileId);
}

/**
 * List everything in the Files API store.
 *
 * Platform-level, not per firm: that store is keyed by `ANTHROPIC_API_KEY` and
 * holds every tenant's uploads together, so there is no firm whose feature
 * flag could sensibly gate reading it. `/api/admin/claude-files` restricts it
 * to an operator instead.
 */
export async function listClaudeFiles() {
  const claude = await anthropicForPlatform('claude_files_maintenance');
  const result = await claude.beta.files.list({
    betas: ['files-api-2025-04-14'],
  });
  return result.data;
}

/**
 * Clean up duplicate files in Claude's Files API.
 * Groups files by filename, keeps the newest one per name, deletes the rest.
 * Platform-level for the same reason as {@link listClaudeFiles}.
 */
export async function cleanupDuplicateClaudeFiles() {
  const claude = await anthropicForPlatform('claude_files_maintenance');
  const files = await listClaudeFiles();

  // Group by filename
  const groups: Record<string, typeof files> = {};
  for (const f of files) {
    const key = f.filename;
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  const deleted: { id: string; filename: string }[] = [];
  const kept: { id: string; filename: string }[] = [];

  for (const [filename, group] of Object.entries(groups)) {
    if (group.length <= 1) {
      if (group.length === 1) kept.push({ id: group[0].id, filename });
      continue;
    }

    // Sort by created_at descending — keep newest
    group.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    kept.push({ id: group[0].id, filename });

    // Delete duplicates
    for (let i = 1; i < group.length; i++) {
      await deleteWith(claude, group[i].id);
      deleted.push({ id: group[i].id, filename });
    }
  }

  return { total: files.length, kept, deleted };
}

function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return mimeTypes[ext] ?? 'application/octet-stream';
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

/**
 * The content block for a file uploaded to the Files API. An image has to go
 * in as an `image`: the API takes only PDF and plain text as a `document` and
 * refuses a PNG or JPEG sent that way with a 400. An image block has no title,
 * so `title` reaches documents only.
 */
export function fileBlock(fileId: string, fileName: string, title?: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.has(ext)) return { type: 'image', source: { type: 'file', file_id: fileId } } as const;
  return { type: 'document', source: { type: 'file', file_id: fileId }, ...(title ? { title } : {}) } as const;
}

// ── Document Analysis ────────────────────────────────────────────

/**
 * Analyze a document using Claude's Files API.
 * Upload the file once, then reference by file_id — works for PDFs (including scanned),
 * Word docs, and other supported formats. No local text extraction needed.
 */
export async function analyzeDocumentWithFile(
  ctx: AiContext,
  claudeFileId: string,
  fileName: string,
  matterName: string,
): Promise<AnalysisResult> {
  const claude = await anthropicFor(ctx);

  const contextLine = matterName ? `\nMatter: "${matterName}"` : '';

  const response = await withRetry(() => claude.beta.messages.create({
    model: MODEL,
    max_tokens: 8192,
    betas: ['files-api-2025-04-14'],
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'file',
            file_id: claudeFileId,
          },
        },
        {
          type: 'text',
          text: `Document: "${fileName}"${contextLine}\n\nAnalyze this document.`,
        },
      ],
    }],
  }));

  return parseAnalysisResponse(response);
}

const TRANSCRIBE_SYSTEM_PROMPT = `You transcribe scanned legal documents for a Philippine law firm.
Return the complete text of the document in reading order as plain text.
Keep headings, paragraph breaks, numbered paragraphs, tables as simple lines, and signature blocks.
Do not summarize, translate, correct, or add commentary. Write [illegible] where a word cannot be read.
Start each new page with a line "[page N]".`;

/**
 * Read a scanned PDF (no text layer) through the Files API and return its
 * text. Used to fill `extracted_text` so keyword search and text-based
 * embeddings cover documents the local parser cannot read.
 */
export async function transcribeDocumentWithFile(
  ctx: AiContext,
  claudeFileId: string,
  fileName: string,
): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number; truncated: boolean }> {
  const claude = await anthropicFor(ctx);

  // A transcription can run long, and the SDK refuses a non-streaming call
  // whose max_tokens implies a possible >10-minute wait; stream and collect.
  const response = await withRetry(() => claude.beta.messages.stream({
    model: MODEL,
    max_tokens: 24_000,
    betas: ['files-api-2025-04-14'],
    system: TRANSCRIBE_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'file', file_id: claudeFileId } },
        { type: 'text', text: `Document: "${fileName}"\n\nTranscribe this document.` },
      ],
    }],
  }).finalMessage());

  const text = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = response.stop_reason === 'max_tokens';

  return {
    text: truncated ? `${text}\n\n[Transcription truncated]` : text,
    model: MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    truncated,
  };
}

/**
 * Legacy: Analyze with raw text (for cases where text is already extracted/cached).
 */
export async function analyzeDocument(
  ctx: AiContext,
  text: string,
  fileName: string,
  matterName: string,
): Promise<AnalysisResult> {
  const claude = await anthropicFor(ctx);

  const userMessage = [
    `Document: "${fileName}"`,
    matterName ? `Matter: "${matterName}"` : '',
    '',
    '--- DOCUMENT TEXT ---',
    text,
  ].filter(Boolean).join('\n');

  const response = await withRetry(() => claude.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  }));

  return parseAnalysisResponse(response);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAnalysisResponse(response: any): AnalysisResult {
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  const parsed = parseJsonResponse(content.text);

  return {
    shortSummary: parsed.shortSummary || '',
    summary: parsed.summary || '',
    entities: {
      parties: parsed.entities?.parties ?? [],
      dates: parsed.entities?.dates ?? [],
      deadlines: parsed.entities?.deadlines ?? [],
      obligations: parsed.entities?.obligations ?? [],
      caseReferences: parsed.entities?.caseReferences ?? [],
      documentType: parsed.entities?.documentType ?? '',
      jurisdiction: parsed.entities?.jurisdiction ?? '',
    },
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: MODEL,
  };
}

// ── Status Report Drafting ────────────────────────────────────────

function statusReportSystemPrompt(firmCtx: string): string {
  return `${firmCtx}

You are a legal writer. Your task is to draft a status report letter to a client about their legal matter.

Style guidelines:
- Write in formal, professional Philippine legal English.
- Be concise but thorough. Each paragraph should convey a specific update or information.
- Use the standard Filipino legal letter format: respectful, client-focused, clear.
- Refer to the firm as "we" or "the Firm" where appropriate.
- Reference case details precisely (docket numbers, court names, dates).
- End with next steps or what the client can expect going forward.
- If annexes are attached, reference them in the body (e.g., "attached hereto as Annex 'A'").
- Do NOT include any greetings, closings, or signatures — only the body paragraphs.

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
  "reLines": "Case title\\nDocket/Case number\\nCourt/Tribunal\\nFor: [violation or nature of case]",
  "bodyParagraphs": ["paragraph 1...", "paragraph 2...", "..."],
  "annexes": [{"letter": "A", "description": "Copy of the Order dated ..."}]
}

Rules:
- Return ONLY valid JSON, no markdown fences or extra text.
- If no annexes are referenced in the source document, return an empty array.
- The reLines should use newline characters to separate the case title, docket number, court, and violation/nature.
- For salutation, use the client's preferred title (Engr., Atty., Mr., Ms., etc.) if known. Otherwise use "Gentlemen/Mesdames:" or "Dear Sir/Madam:".
- Body paragraphs should typically include: (1) opening reference to the matter, (2) summary of recent developments from the document, (3) implications or analysis, (4) next steps.
- Write the body as if signing lawyers from the team are writing to the client.`;
}

export interface StatusReportDraft {
  addressee: {
    name: string;
    address?: string | null;
    email?: string | null;
    throughName?: string | null;
    throughTitle?: string | null;
  };
  salutation: string;
  reLines: string;
  bodyParagraphs: string[];
  annexes: { letter: string; description: string }[];
}

/**
 * Draft a status report. Uses Files API if a claude_file_id is available,
 * otherwise falls back to raw text.
 */
// ── Matter Summary Generation ─────────────────────────────────────

const MATTER_SUMMARY_SYSTEM_PROMPT = `You are a legal matter analyst for a Philippine law firm. Given a legal matter and its related entities (deliverables, hearings, filings, files, tasks), produce a concise summary.

Return ONLY valid JSON with this structure:
{
  "summary": "A 1-2 sentence summary of the matter based on its current state and related entities. Be specific — mention the matter type, key activities, and current posture.",
  "latestIncident": "A single sentence describing the most recent notable event (new deliverable, hearing, or file). Include the date and what happened. If nothing notable, use null.",
  "latestIncidentDate": "YYYY-MM-DD of the latest incident, or null"
}

Rules:
- Return ONLY valid JSON, no markdown fences or extra text.
- The summary should give a lawyer a quick understanding of where this matter stands.
- Focus on actionable information: pending deadlines, recent filings, upcoming hearings.
- For the latest incident, prioritize the most recent deliverable, hearing, or file by date.
- Use clear, professional language suitable for a practicing lawyer.`;

export interface MatterSummaryResult {
  summary: string;
  latestIncident: string | null;
  latestIncidentDate: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Generate an AI summary for a matter based on its related entities.
 */
export async function generateMatterSummary(ctx: AiContext, matter: {
  name: string;
  matterCode?: string;
  type?: string;
  status?: string;
  caseTitle?: string;
  caseNumber?: string;
  court?: string;
  clientName?: string;
}, entities: {
  deliverables: { name: string; status: string; dueDate?: string | null; createdTime?: string | null }[];
  hearings: { name: string; date?: string | null; status?: string; type?: string }[];
  filings: { name: string; date?: string | null; status?: string }[];
  files: { name: string; dateReceived?: string | null; origin?: string }[];
  tasks: { name: string; status?: string; dueDate?: string | null; done?: boolean }[];
}): Promise<MatterSummaryResult> {
  const claude = await anthropicFor(ctx);

  const matterCtx = [
    `Matter: ${matter.name}`,
    matter.matterCode ? `Code: ${matter.matterCode}` : '',
    matter.type ? `Type: ${matter.type}` : '',
    matter.status ? `Status: ${matter.status}` : '',
    matter.caseTitle ? `Case Title: ${matter.caseTitle}` : '',
    matter.caseNumber ? `Case Number: ${matter.caseNumber}` : '',
    matter.court ? `Court: ${matter.court}` : '',
    matter.clientName ? `Client: ${matter.clientName}` : '',
  ].filter(Boolean).join('\n');

  const sections: string[] = [];

  if (entities.deliverables.length > 0) {
    sections.push('--- DELIVERABLES ---');
    entities.deliverables.forEach((d) => {
      sections.push(`- ${d.name} | Status: ${d.status}${d.dueDate ? ` | Due: ${d.dueDate}` : ''}${d.createdTime ? ` | Created: ${d.createdTime.split('T')[0]}` : ''}`);
    });
  }

  if (entities.hearings.length > 0) {
    sections.push('\n--- HEARINGS ---');
    entities.hearings.forEach((h) => {
      sections.push(`- ${h.name}${h.date ? ` | Date: ${toManilaDay(h.date)}` : ''}${h.status ? ` | Status: ${h.status}` : ''}`);
    });
  }

  if (entities.filings.length > 0) {
    sections.push('\n--- FILINGS ---');
    entities.filings.forEach((f) => {
      sections.push(`- ${f.name}${f.date ? ` | Date: ${f.date.split('T')[0]}` : ''}${f.status ? ` | Status: ${f.status}` : ''}`);
    });
  }

  if (entities.files.length > 0) {
    sections.push('\n--- FILES ---');
    entities.files.slice(0, 20).forEach((f) => {
      sections.push(`- ${f.name}${f.dateReceived ? ` | Received: ${f.dateReceived}` : ''}${f.origin ? ` | Origin: ${f.origin}` : ''}`);
    });
    if (entities.files.length > 20) {
      sections.push(`... and ${entities.files.length - 20} more files`);
    }
  }

  if (entities.tasks.length > 0) {
    sections.push('\n--- TASKS ---');
    entities.tasks.filter((t) => !t.done).slice(0, 15).forEach((t) => {
      sections.push(`- ${t.name}${t.status ? ` | Status: ${t.status}` : ''}${t.dueDate ? ` | Due: ${t.dueDate}` : ''}`);
    });
  }

  const userMessage = [
    '--- MATTER ---',
    matterCtx,
    '',
    ...sections,
    '',
    'Generate a summary of this matter.',
  ].join('\n');

  const response = await withRetry(() => claude.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: MATTER_SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  }));

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  const parsed = parseJsonResponse(content.text);

  return {
    summary: parsed.summary || '',
    latestIncident: parsed.latestIncident || null,
    latestIncidentDate: parsed.latestIncidentDate || null,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: MODEL,
  };
}

// ── Status Report Drafting ────────────────────────────────────────

export async function draftStatusReport(opts: {
  firmId: string;
  documentText?: string;
  claudeFileId?: string;
  fileName: string;
  matter: {
    name?: string;
    caseTitle?: string;
    caseNumber?: string;
    court?: string;
    clientName?: string;
    nature?: string;
  };
  client?: {
    name?: string;
    fullCompanyName?: string;
    contactEmail?: string;
    pointPersons?: string[];
  };
}): Promise<StatusReportDraft> {
  // This one already carried the firm in its options bag, so it names the
  // feature here rather than taking a second context argument.
  const claude = await anthropicFor({ firmId: opts.firmId, feature: 'ai_analysis' });

  const matterCtx = [
    opts.matter.name ? `Matter Name: ${opts.matter.name}` : '',
    opts.matter.caseTitle ? `Case Title: ${opts.matter.caseTitle}` : '',
    opts.matter.caseNumber ? `Case/Docket Number: ${opts.matter.caseNumber}` : '',
    opts.matter.court ? `Court/Tribunal: ${opts.matter.court}` : '',
    opts.matter.nature ? `Nature/For: ${opts.matter.nature}` : '',
    opts.matter.clientName ? `Client Name: ${opts.matter.clientName}` : '',
  ].filter(Boolean).join('\n');

  const clientCtx = [
    opts.client?.fullCompanyName ? `Company Name: ${opts.client.fullCompanyName}` : '',
    opts.client?.name ? `Client Short Name: ${opts.client.name}` : '',
    opts.client?.contactEmail ? `Contact Email: ${opts.client.contactEmail}` : '',
    opts.client?.pointPersons?.length ? `Point Persons: ${opts.client.pointPersons.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const textPart = [
    '--- MATTER DETAILS ---',
    matterCtx || '(No matter details available)',
    '',
    '--- CLIENT DETAILS ---',
    clientCtx || '(No client details available)',
    '',
    `--- SOURCE DOCUMENT: "${opts.fileName}" ---`,
  ].join('\n');

  // Build content blocks — use file_id if available, else raw text
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = [];

  if (opts.claudeFileId) {
    contentBlocks.push({
      type: 'document',
      source: { type: 'file', file_id: opts.claudeFileId },
    });
    contentBlocks.push({
      type: 'text',
      text: textPart + '\n\nDraft a status report based on this document.',
    });
  } else {
    contentBlocks.push({
      type: 'text',
      text: textPart + '\n' + (opts.documentText ?? '') + '\n\nDraft a status report based on this document.',
    });
  }

  const useBeta = !!opts.claudeFileId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createParams: any = {
    model: MODEL,
    max_tokens: 4096,
    system: statusReportSystemPrompt(await loadFirmPromptContext(opts.firmId)),
    messages: [{ role: 'user', content: contentBlocks }],
    ...(useBeta ? { betas: ['files-api-2025-04-14'] } : {}),
  };

  const response = useBeta
    ? await withRetry(() => claude.beta.messages.create(createParams))
    : await withRetry(() => claude.messages.create(createParams));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (response as any).content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  const parsed = parseJsonResponse(content.text);

  return {
    addressee: {
      name: parsed.addressee?.name ?? opts.matter.clientName ?? 'Valued Client',
      address: parsed.addressee?.address ?? null,
      email: parsed.addressee?.email ?? opts.client?.contactEmail ?? null,
      throughName: parsed.addressee?.throughName ?? null,
      throughTitle: parsed.addressee?.throughTitle ?? null,
    },
    salutation: parsed.salutation ?? 'Dear Sir/Madam:',
    reLines: parsed.reLines ?? opts.matter.caseTitle ?? '',
    bodyParagraphs: parsed.bodyParagraphs ?? [],
    annexes: parsed.annexes ?? [],
  };
}
