import type Anthropic from '@anthropic-ai/sdk';
import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import JSZip from 'jszip';
import { getUpdatedTemplateFileId, getUpdatedTemplateBuffer } from './template-updater';
import { loadDocxBrand } from './brand';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import { toolArray } from '@/lib/ai/json-response';

/**
 * The house formatting standards handed to the model. Everything here is either
 * a Philippine court requirement (pleading paper size, Book Antiqua 14 under the
 * Efficient Use of Paper Rule) or a layout convention — the only firm-specific
 * part is the body typeface, which is interpolated.
 */
const houseStyleGuide = (bodyFont: string) => `
STYLE GUIDE - DOCUMENT FORMATTING STANDARDS

GENERAL:
- Letters/opinions/reports: ${bodyFont}, Size 12, A4 paper
- Pleadings: Book Antiqua, Size 14, Legal size (13" x 8.5")
- Pleading margins: Left 1.5", Top 1.2", Right 1.0", Bottom 1.0"
- Single-spaced with 1.5 spacing between paragraphs for pleadings

PLEADING FORMAT:
- Court name: Size 14, bold, all caps, center-aligned
- Party names: bold, Size 14; designations in italics
- "versus" in italics flanked by hyphens: - versus -
- Title: Bold, all caps, center-aligned, Size 18
- Each paragraph numbered consecutively, first line indented 1 inch
- Subparagraphs: 1.1, 1.2, 1.3 format, indented 1.5"
- Section headings: Bold, all caps, center-aligned
- Prayer: "WHEREFORE" in bold all caps, reliefs numbered 1, 2, 3
- Signature block: bordered table, right side, firm name bold all caps

LETTER FORMAT:
- "Subject:" (not "Re:"), main topic in bold
- Salutation: "Dear [Name]:" (colon, not comma)
- No paragraph indentation in body
- Complimentary close: "Very truly yours,"
- Signature: "For the Firm:"

CITATION (Simplified Ateneo System):
- Legal citations in footnotes, not in-text
- Cases: Title in italics, G.R. number and date in footnote
- Statutes: Full name at first mention, abbreviated later
- Use supra and Id. for repeated citations

WRITING STYLE:
- Active voice preferred
- Oxford comma in all lists
- Concise sentences (20-25 words)
- Numbers: spell out 0-9, numerals for 10+
- Currency: "Php" (e.g., Php 500,000.00)
- Dates: Day-Month-Year (e.g., 1 January 2025)
- "v." not "vs."
- Boldface for emphasis (not underline)
- Italicize case titles and non-English words

FILE NAMING: [Matter ID] Document Title (initials)
`;

export interface GenerateDocumentParams {
  firmId: string;
  templatePrompt: string;
  matterContext: {
    name?: string;
    matterCode?: string;
    type?: string;
    caseTitle?: string;
    caseNumber?: string;
    court?: string;
    clientName?: string;
    parties?: string;
  };
  additionalInstructions?: string;
  signerName?: string;
  signerPosition?: string;
  /**
   * Drafting Studio grounding: the matter brief, firm knowledge pages, and
   * relevant prior filings, assembled by lib/ai/draft-grounding. Injected so
   * the draft is grounded in the matter's facts and the firm's own work.
   */
  groundingContext?: string;
  /**
   * Responsive drafting: the document this draft is replying to (e.g. the
   * opposing party's motion). Attached via the Claude Files API when a
   * `claudeFileId` is available, otherwise inlined as `text`. The model is told
   * to rebut it point by point.
   */
  respondingTo?: {
    name: string;
    claudeFileId?: string | null;
    text?: string | null;
  };
  /** Model override. Defaults to Haiku; the Drafting Studio passes Sonnet. */
  model?: string;
  /** Output token budget. Defaults to 8192; long pleadings need more. */
  maxTokens?: number;
  /** Revise an existing draft in place instead of drafting from scratch. */
  reviseFrom?: { currentText: string; instruction: string };
}

interface DocumentContent {
  paragraphs: DocumentParagraph[];
}

interface DocumentParagraph {
  text: string;
  bold?: boolean;
  italic?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justified';
  size?: number; // font size in half-points (24 = 12pt)
  spacing_after?: number; // spacing after paragraph in twips
  indent?: number; // left indent in twips
  underline?: boolean;
  allCaps?: boolean;
}

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
      console.log(`[template-generator] Rate limited, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw new Error('Unreachable');
}


function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build base run properties (font, size) shared across all runs in a paragraph.
 */
function buildBaseRpr(p: DocumentParagraph, bodyFont: string): string[] {
  const parts: string[] = [];
  const f = escapeXml(bodyFont);
  parts.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>`);
  const sz = p.size ?? 24;
  parts.push(`<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`);
  return parts;
}

/**
 * Build a run's <w:rPr> XML string with optional inline overrides.
 */
function buildRunRpr(
  baseRpr: string[],
  opts: { bold?: boolean; italic?: boolean; underline?: boolean; allCaps?: boolean },
): string {
  const parts = [...baseRpr];
  if (opts.bold) parts.push('<w:b/><w:bCs/>');
  if (opts.italic) parts.push('<w:i/><w:iCs/>');
  if (opts.underline) parts.push('<w:u w:val="single"/>');
  if (opts.allCaps) parts.push('<w:caps/>');
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

/**
 * Parse inline markdown-like formatting in text and produce OOXML runs.
 * Supports **bold**, *italic*, ***bold italic***, and __underline__.
 */
function textToRuns(
  text: string,
  baseRpr: string[],
  paragraphOpts: { bold?: boolean; italic?: boolean; underline?: boolean; allCaps?: boolean },
): string {
  // Split by formatting markers: **bold**, *italic*, __underline__
  // Process bold+italic first (***), then bold (**), then underline (__), then italic (*)
  const segments: { text: string; bold: boolean; italic: boolean; underline: boolean }[] = [];

  // Regex to find formatting markers
  const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      segments.push({ text: text.substring(lastIndex, match.index), bold: false, italic: false, underline: false });
    }

    if (match[2]) {
      // ***bold italic***
      segments.push({ text: match[2], bold: true, italic: true, underline: false });
    } else if (match[3]) {
      // **bold**
      segments.push({ text: match[3], bold: true, italic: false, underline: false });
    } else if (match[4]) {
      // __underline__
      segments.push({ text: match[4], bold: false, italic: false, underline: true });
    } else if (match[5]) {
      // *italic*
      segments.push({ text: match[5], bold: false, italic: true, underline: false });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    segments.push({ text: text.substring(lastIndex), bold: false, italic: false, underline: false });
  }

  // If no inline formatting found, treat as single segment
  if (segments.length === 0) {
    segments.push({ text, bold: false, italic: false, underline: false });
  }

  // Convert segments to runs
  return segments.map(seg => {
    const rpr = buildRunRpr(baseRpr, {
      bold: paragraphOpts.bold || seg.bold,
      italic: paragraphOpts.italic || seg.italic,
      underline: paragraphOpts.underline || seg.underline,
      allCaps: paragraphOpts.allCaps,
    });
    return `<w:r>${rpr}<w:t xml:space="preserve">${escapeXml(seg.text)}</w:t></w:r>`;
  }).join('');
}

/**
 * Convert a DocumentParagraph to OOXML <w:p> element.
 * Supports both paragraph-level formatting (bold entire paragraph)
 * and inline markdown formatting (**bold**, *italic*, __underline__).
 */
function paragraphToXml(p: DocumentParagraph, bodyFont: string): string {
  const baseRpr = buildBaseRpr(p, bodyFont);
  const pprParts: string[] = [];
  const paraOpts = {
    bold: p.bold,
    italic: p.italic,
    underline: p.underline,
    allCaps: p.allCaps,
  };

  // Alignment
  if (p.alignment) {
    const alignMap: Record<string, string> = {
      left: 'start', center: 'center', right: 'end', justified: 'both',
    };
    pprParts.push(`<w:jc w:val="${alignMap[p.alignment] || 'start'}"/>`);
  } else {
    pprParts.push('<w:jc w:val="both"/>');
  }

  // Spacing
  if (p.spacing_after !== undefined) {
    pprParts.push(`<w:spacing w:after="${p.spacing_after}"/>`);
  }

  // Indent
  if (p.indent) {
    pprParts.push(`<w:ind w:left="${p.indent}"/>`);
  }

  // Default run properties for paragraph
  const defaultRpr = buildRunRpr(baseRpr, paraOpts);
  pprParts.push(defaultRpr);

  const ppr = `<w:pPr>${pprParts.join('')}</w:pPr>`;

  // Handle line breaks within text, then inline formatting within each line.
  // Coerce: a model/salvaged paragraph object can omit "text" (it would
  // otherwise throw on .split). Treat a missing text as an empty line.
  const textParts = (p.text ?? '').split('\n');
  const runs = textParts.map((part, i) => {
    let lineRuns = textToRuns(part, baseRpr, paraOpts);
    if (i < textParts.length - 1) {
      const brRpr = buildRunRpr(baseRpr, paraOpts);
      lineRuns += `<w:r>${brRpr}<w:br/></w:r>`;
    }
    return lineRuns;
  }).join('');

  return `<w:p>${ppr}${runs}</w:p>`;
}

/**
 * Inject generated content into the template DOCX body.
 * Uses the updated template buffer (with current team letterhead sidebar).
 * Preserves headers, footers, and all other template structure.
 */
async function injectContentIntoTemplate(
  paragraphs: DocumentParagraph[],
  firmId: string,
  bodyFont: string,
): Promise<Buffer> {
  // Get the template with up-to-date letterhead sidebar
  const templateBuffer = await getUpdatedTemplateBuffer(firmId);
  const zip = await JSZip.loadAsync(templateBuffer);

  const documentXml = await zip.files['word/document.xml'].async('string');

  // Find the body content between <w:body> and </w:body>
  const bodyStart = documentXml.indexOf('<w:body>');
  const bodyEnd = documentXml.indexOf('</w:body>');

  if (bodyStart === -1 || bodyEnd === -1) {
    throw new Error('Could not find <w:body> in document.xml');
  }

  // Extract sectPr (page layout settings) from existing body — must preserve it
  const existingBody = documentXml.substring(bodyStart + '<w:body>'.length, bodyEnd);
  const sectPrMatch = existingBody.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const sectPr = sectPrMatch ? sectPrMatch[0] : '';

  // Build new body content
  const bodyParagraphs = paragraphs.map(p => paragraphToXml(p, bodyFont)).join('');
  const newBody = `<w:body>${bodyParagraphs}${sectPr}</w:body>`;

  // Replace body in document.xml
  const newDocumentXml = documentXml.substring(0, bodyStart) + newBody + documentXml.substring(bodyEnd + '</w:body>'.length);

  zip.file('word/document.xml', newDocumentXml);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return Buffer.from(buffer);
}

/**
 * Generate a document DOCX with firm letterhead.
 *
 * Two-step approach for reliable letterhead:
 * 1. Ask Claude to generate the document content as structured JSON
 * 2. Inject that content into the template DOCX locally (preserving headers/footers)
 *
 * This ensures the letterhead is always preserved since we never ask Claude
 * to handle the DOCX formatting — only the text content.
 */
// Structured-output contract for the document generator. The API constrains
// the model to this schema, so the result is read from tool_use.input rather
// than parsed from free-text JSON.
const EMIT_DOCUMENT_TOOL = {
  name: 'emit_document',
  description: 'Emit the finished document as an ordered array of formatted paragraphs.',
  input_schema: {
    type: 'object' as const,
    properties: {
      paragraphs: {
        type: 'array',
        description: 'The document content, in order, including signature block.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Paragraph text; \\n for line breaks; **bold**/*italic*/__underline__ inline.' },
            bold: { type: 'boolean' },
            italic: { type: 'boolean' },
            underline: { type: 'boolean' },
            allCaps: { type: 'boolean' },
            alignment: { type: 'string', enum: ['left', 'center', 'right', 'justified'] },
            size: { type: 'integer', description: 'Font size in half-points (24 = 12pt).' },
            spacing_after: { type: 'integer', description: 'Spacing after, in twips.' },
            indent: { type: 'integer', description: 'Left indent, in twips.' },
          },
          required: ['text'],
        },
      },
    },
    required: ['paragraphs'],
  },
};

// Continuation contract — emits only the remaining paragraphs when a first pass
// hits the token cap. They are appended to the first pass's paragraphs and the
// document is injected into the template once from the merged list.
const EMIT_DOCUMENT_CONTINUATION_TOOL = {
  name: 'emit_document_continuation',
  description: 'Continue a document that was cut off. Emit ONLY the paragraphs that come after the last paragraph already written — do not repeat any prior paragraph.',
  input_schema: {
    type: 'object' as const,
    properties: {
      paragraphs: EMIT_DOCUMENT_TOOL.input_schema.properties.paragraphs,
    },
    required: ['paragraphs'],
  },
};

/**
 * Recover complete paragraph objects from a truncated/invalid JSON string by
 * scanning the "paragraphs" array for balanced {...} objects that parse.
 * String-aware so braces inside text don't throw off the depth count.
 */
function salvageParagraphs(jsonStr: string): DocumentParagraph[] {
  const start = jsonStr.indexOf('"paragraphs"');
  if (start < 0) return [];
  const arrStart = jsonStr.indexOf('[', start);
  if (arrStart < 0) return [];

  const body = jsonStr.slice(arrStart + 1);
  const out: DocumentParagraph[] = [];
  let depth = 0, objStart = -1, inStr = false, escaped = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) objStart = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          const obj = JSON.parse(body.slice(objStart, i + 1));
          // Only accept real paragraph objects (have a string "text"); skip
          // any nested/metadata objects so they don't reach the XML builder.
          if (obj && typeof obj === 'object' && typeof (obj as { text?: unknown }).text === 'string') {
            out.push(obj as DocumentParagraph);
          }
        } catch { /* skip partial */ }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }
  return out;
}

const MAX_CONTINUATIONS = 2;

/**
 * Run a streamed continuation pass, returning the remaining paragraphs plus
 * whether it too hit the cap. Continuations never attach a file, so the plain
 * (non-beta) endpoint is always used. Thinking is disabled to allow forced tool
 * choice.
 */
async function runDocContinuation(
  claude: Anthropic,
  opts: { model: string; maxTokens: number; prompt: string },
): Promise<{ paragraphs: DocumentParagraph[]; truncated: boolean }> {
  const createParams = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    thinking: { type: 'disabled' as const },
    tools: [EMIT_DOCUMENT_CONTINUATION_TOOL],
    tool_choice: { type: 'tool' as const, name: 'emit_document_continuation' },
    messages: [{ role: 'user' as const, content: opts.prompt }],
  };
  const response = await withRetry(() => claude.messages.stream(createParams).finalMessage());
  const truncated = response.stop_reason === 'max_tokens';
  const blocks = response.content as Array<{ type: string; input?: unknown }>;
  const toolUse = blocks.find((b) => b.type === 'tool_use');
  const paragraphs =
    toolUse && toolUse.input && typeof toolUse.input === 'object'
      ? (toolUse.input as { paragraphs?: unknown }).paragraphs
      : undefined;
  return { paragraphs: toolArray<DocumentParagraph>(paragraphs), truncated };
}

export async function generateDocumentDocx(
  params: GenerateDocumentParams,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const claude = await anthropicFor({ firmId: params.firmId, feature: 'ai_analysis' });
  const brand = await loadDocxBrand(params.firmId);
  const firmCtx = await loadFirmPromptContext(params.firmId);
  const styleGuide = houseStyleGuide(brand.fontFamily);

  // Trigger template update (for Claude Files API + local cache) in parallel
  const templateUpdatePromise = getUpdatedTemplateFileId(params.firmId).catch(() => null);

  const matterInfo = [
    params.matterContext.name && `Matter: ${params.matterContext.name}`,
    params.matterContext.matterCode && `Code: ${params.matterContext.matterCode}`,
    params.matterContext.type && `Type: ${params.matterContext.type}`,
    params.matterContext.caseTitle && `Case Title: ${params.matterContext.caseTitle}`,
    params.matterContext.caseNumber && `Case Number: ${params.matterContext.caseNumber}`,
    params.matterContext.court && `Court: ${params.matterContext.court}`,
    params.matterContext.clientName && `Client: ${params.matterContext.clientName}`,
    params.matterContext.parties && `Parties: ${params.matterContext.parties}`,
  ].filter(Boolean).join('\n');

  const respondingTo = params.respondingTo;
  // Inline the responded-to document only when there is no Files API id; with a
  // file id the document is attached as a content block instead (handled below).
  const respondingBlock = respondingTo
    ? respondingTo.claudeFileId
      ? `RESPONSIVE PLEADING — DOCUMENT BEING RESPONDED TO:\nThe document titled "${respondingTo.name}" is ATTACHED to this message. You are drafting a pleading in RESPONSE to it. Read it closely and answer it: address and rebut its specific arguments, allegations, and prayer point by point, in the firm's voice and consistent with the matter brief. Do not leave any material contention unanswered.`
      : `RESPONSIVE PLEADING — DOCUMENT BEING RESPONDED TO ("${respondingTo.name}"):\n${respondingTo.text}\n\nYou are drafting a pleading in RESPONSE to the document above. Address and rebut its specific arguments, allegations, and prayer point by point, in the firm's voice and consistent with the matter brief. Do not leave any material contention unanswered.`
    : '';

  const reviseBlock = params.reviseFrom
    ? `\nYou are REVISING an existing draft. Apply the revision below, then RE-EMIT THE COMPLETE document via emit_document — preserve everything the revision does not ask you to change (structure, facts, citations, salutation, and signatory).\n\nREVISION REQUESTED:\n${params.reviseFrom.instruction}\n\nCURRENT DRAFT (full text):\n${params.reviseFrom.currentText}\n`
    : '';

  const userPrompt = `${firmCtx}

You are a legal document writer.

${styleGuide}

DOCUMENT TYPE AND INSTRUCTIONS:
${params.templatePrompt}
${reviseBlock}
MATTER CONTEXT:
${matterInfo || 'No specific matter context provided.'}

${respondingBlock ? `${respondingBlock}\n` : ''}
${params.groundingContext ? `${params.groundingContext}\n\nUse the matter brief above as the factual basis. Apply the firm knowledge. Reuse the structure and phrasing of our prior work where appropriate, but never copy another matter's specific facts, names, or figures.\n` : ''}
${params.additionalInstructions ? `ADDITIONAL INSTRUCTIONS:\n${params.additionalInstructions}` : ''}

${params.signerName ? `SIGNER: ${params.signerName}${params.signerPosition ? `, ${params.signerPosition}` : ''}` : ''}

Return the document by calling the emit_document tool with an array of paragraphs.

Formatting rules:
- "size" is in half-points: 24 = 12pt, 28 = 14pt, 36 = 18pt
- "spacing_after" is in twips: 200 = normal paragraph spacing, 0 = no space
- "indent" is in twips: 720 = 0.5 inch, 1440 = 1 inch
- "alignment": "left", "center", "right", or "justified"
- For empty lines, use a paragraph with empty text and spacing_after 200
- Use \\n within "text" for line breaks within the same paragraph
- For paragraph-level bold/italic: set "bold": true or "italic": true (applies to entire paragraph)
- For INLINE formatting within a paragraph: use **bold text**, *italic text*, or __underlined text__ in the "text" field
  Example: "Please pay **Php 500,000.00** within *thirty (30) days*."
- Include ALL document content: date, addressee, subject, body, closing, signature block
- Do NOT include the firm letterhead — it is already in the template`;

  // When responding to a document we have on the Files API, attach it as a
  // document block ahead of the prompt so the model reads the actual filing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userContent: any[] = [];
  const attachFileId = respondingTo?.claudeFileId ?? null;
  if (attachFileId) {
    userContent.push({ type: 'document', source: { type: 'file', file_id: attachFileId }, title: respondingTo?.name });
  }
  userContent.push({ type: 'text', text: userPrompt });

  // Structured output via tool use: the API constrains generation to the
  // schema, so we read tool_use.input directly instead of parsing free-text
  // JSON (which truncated mid-object on long pleadings). Salvage is kept only
  // as a defensive fallback for the rare no-tool-use response.
  const model = params.model ?? 'claude-haiku-4-5';
  const maxTokens = params.maxTokens ?? 8192;
  const createParams = {
    model,
    max_tokens: maxTokens,
    // Adaptive thinking is incompatible with forcing a specific tool; disable it.
    thinking: { type: 'disabled' as const },
    tools: [EMIT_DOCUMENT_TOOL],
    tool_choice: { type: 'tool' as const, name: 'emit_document' },
    messages: [{ role: 'user' as const, content: userContent }],
  };
  // The Files API needs its beta header; only opt in when a file is attached.
  // Streaming keeps a large max_tokens under the SDK HTTP timeout.
  const response = attachFileId
    ? await withRetry(() => claude.beta.messages.stream({ ...createParams, betas: ['files-api-2025-04-14'] }).finalMessage())
    : await withRetry(() => claude.messages.stream(createParams).finalMessage());

  // The model hit its output cap — the document tail (for a letter: the closing
  // and signature) may be missing. Flagged to the caller, but continuation
  // passes below try to finish it first.
  let truncated = response.stop_reason === 'max_tokens';

  let content: DocumentContent;
  const blocks = response.content as Array<{ type: string; input?: unknown; text?: string }>;
  const toolUse = blocks.find((b) => b.type === 'tool_use');
  // The model sometimes sends the paragraphs array serialized as a string;
  // decode it rather than discarding the whole draft.
  const rawParagraphs =
    toolUse?.input && typeof toolUse.input === 'object'
      ? (toolUse.input as { paragraphs?: unknown }).paragraphs
      : undefined;
  const toolParagraphs = toolArray<DocumentParagraph>(rawParagraphs);
  if (toolUse?.input && typeof toolUse.input === 'object' && (Array.isArray(rawParagraphs) || toolParagraphs.length > 0)) {
    content = { ...(toolUse.input as DocumentContent), paragraphs: toolParagraphs };
  } else {
    // Fallback: parse a text JSON block, salvaging truncated paragraphs.
    const textBlock = blocks.find((b) => b.type === 'text');
    let jsonStr = textBlock && typeof textBlock.text === 'string' ? textBlock.text.trim() : '';
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    try {
      content = JSON.parse(jsonStr);
    } catch {
      const salvaged = salvageParagraphs(jsonStr);
      if (salvaged.length === 0) {
        console.error('[template-generator] No tool_use and unparseable text:', jsonStr.slice(0, 500));
        throw new Error('Claude returned no usable document content');
      }
      console.warn(`[template-generator] Salvaged ${salvaged.length} paragraphs from truncated/invalid JSON`);
      content = { paragraphs: salvaged };
    }
  }

  if (!content.paragraphs || !Array.isArray(content.paragraphs)) {
    throw new Error('Claude response missing paragraphs array');
  }

  // Continue past the token cap by appending the remaining paragraphs, so the
  // letter reaches its closing and signature. Merged once into the template below.
  for (let pass = 0; truncated && pass < MAX_CONTINUATIONS; pass++) {
    const tail = content.paragraphs.slice(-3).map((p) => p.text ?? '').filter(Boolean).join('\n');
    const contPrompt = `${firmCtx}\n\nYou are continuing a document that was cut off before completion.\n\n${styleGuide}\n\nEmit ONLY the paragraphs that come AFTER the text shown below — do not repeat any paragraph already written. Include the complimentary close and signature block if not yet present. Do NOT include the firm letterhead (it is already in the template).\n\nLAST PARAGRAPHS WRITTEN SO FAR:\n${tail}\n\nReturn the continuation by calling the emit_document_continuation tool.`;
    const cont = await runDocContinuation(claude, { model, maxTokens, prompt: contPrompt });
    if (cont.paragraphs.length === 0) break;
    content.paragraphs.push(...cont.paragraphs);
    truncated = cont.truncated;
  }

  // Wait for template sidebar update
  await templateUpdatePromise;

  // Inject content into template DOCX (preserving letterhead)
  const buffer = await injectContentIntoTemplate(content.paragraphs, params.firmId, brand.fontFamily);

  console.log(`[template-generator] DOCX generated locally with letterhead (${(buffer.length / 1024).toFixed(1)}KB, ${content.paragraphs.length} paragraphs${truncated ? ', TRUNCATED at max_tokens' : ''})`);
  return { buffer, truncated };
}
