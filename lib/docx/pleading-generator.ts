// Pleading generator — Philippine litigation drafting.
//
// Unlike the Document Generator (which injects content into the firm letterhead
// template), a pleading is NOT a letter: no letterhead, Book Antiqua 14pt, and
// the Efficient Use of Paper Rule page setup (A.M. No. 11-9-4-SC). Built with
// the `docx` library so we get the things raw-OOXML injection can't: real Word
// multilevel numbering, heading styles, and bottom-of-page footnotes.
//
// The model returns a structured pleading (caption + typed body blocks) via
// forced tool use; this module lays it out. Citations are emitted inline as
// [[fn:...]] tokens and become real footnotes.

import type Anthropic from '@anthropic-ai/sdk';
import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import {
  Document, Packer, Paragraph, TextRun, FootnoteReferenceRun,
  Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle,
  LevelFormat, HeadingLevel, LineRuleType,
} from 'docx';
import { toolArray } from '@/lib/ai/json-response';

const FONT = 'Book Antiqua';
const SIZE = 28;        // 14pt (half-points) — Efficient Use of Paper Rule
const SIZE_FN = 20;     // 10pt footnotes
const NUMBERING_REF = 'pleading';

// Efficient Use of Paper Rule: 8.5" x 13" paper; margins L1.5 T1.2 R1.0 B1.0.
const PAGE = { width: 12240, height: 18720 };
const MARGIN = { top: 1728, right: 1440, bottom: 1440, left: 2160 };

export interface PleadingParams {
  /** Whose consent this draft runs under. Required — the gate has no default. */
  firmId: string;
  documentType: string;
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
  /** The firm's name, for the signature block and the drafting brief. */
  firmName: string;
  signerName?: string;
  signerPosition?: string;
  groundingContext?: string;
  respondingTo?: { name: string; claudeFileId?: string | null; text?: string | null };
  model?: string;
  maxTokens?: number;
  /** Revise an existing draft in place instead of drafting from scratch. */
  reviseFrom?: { currentText: string; instruction: string };
}

// ── Structured-output contract ────────────────────────────────────────────
// The pleading is emitted in two forced-tool steps: caption+title first (small,
// so it can never be lost to token-cap truncation), then the body (long) with a
// continuation loop. A single combined tool used to fail because the model emits
// the huge `body` field before the small required `caption`; on a long body the
// response hit the token cap before the caption was ever written.
const BODY_ARRAY_SCHEMA = {
  type: 'array' as const,
  description: 'The pleading body in order. Do NOT include the caption, title, or signature block here.',
  items: {
    type: 'object' as const,
    properties: {
      type: { type: 'string', enum: ['heading', 'item', 'text'], description: '"heading" = a section heading (e.g. PREFATORY STATEMENT, ARGUMENTS, PRAYER); "item" = an auto-numbered paragraph; "text" = an unnumbered line (intro line, the WHEREFORE lead-in).' },
      level: { type: 'integer', description: 'For "heading": 1 (major) or 2 (sub). For "item": 0 (1.), 1 (1.1.), or 2 (1.1.1.). Ignored for "text".' },
      text: { type: 'string', description: 'The content. Use *italics* for case titles and non-English words, **bold** for emphasis. Put every citation in a footnote with an inline [[fn:Author, Case Title, G.R. No., date.]] token placed right after the sentence it supports.' },
      align: { type: 'string', enum: ['left', 'center', 'right', 'justified'], description: 'Optional, for "text" blocks only.' },
    },
    required: ['type', 'text'],
  },
};

const EMIT_CAPTION_TOOL = {
  name: 'emit_caption',
  description: 'Emit ONLY the pleading caption (court + parties) and title. The body is drafted in a separate step — do not include any body content here.',
  input_schema: {
    type: 'object' as const,
    properties: {
      caption: {
        type: 'object',
        properties: {
          court: { type: 'string', description: 'Court + branch, e.g. "REGIONAL TRIAL COURT\\nBRANCH 141, MAKATI CITY". Do NOT include "Republic of the Philippines" — it is added.' },
          plaintiff: { type: 'string', description: 'Name of the plaintiff/petitioner/complainant party.' },
          plaintiffDesignation: { type: 'string', description: 'e.g. "Plaintiff", "Petitioner", "Complainant".' },
          defendant: { type: 'string', description: 'Name of the defendant/respondent/accused party.' },
          defendantDesignation: { type: 'string', description: 'e.g. "Accused", "Defendant", "Respondent".' },
          caseNumber: { type: 'string', description: 'Docket/case number.' },
          caseFor: { type: 'string', description: 'Nature of the action, e.g. "Estafa". Empty if none.' },
        },
        required: ['court', 'plaintiff', 'plaintiffDesignation', 'defendant', 'defendantDesignation', 'caseNumber'],
      },
      title: { type: 'string', description: 'Pleading title, ALL CAPS, e.g. "COMMENT/OPPOSITION".' },
      subtitle: { type: 'string', description: 'Optional parenthetical, e.g. "(To the Motion for Leave ... dated 25 May 2026)". Empty if none.' },
    },
    required: ['caption', 'title'],
  },
};

// Body emitter — used both for the initial full-body pass and, with a different
// prompt, for continuations when the body hits the token cap. Continuation
// blocks are appended and the DOCX is built once from the merged body, so
// numbering and footnotes stay continuous.
const EMIT_BODY_TOOL = {
  name: 'emit_pleading_body',
  description: 'Emit the pleading body as an ordered list of typed blocks. Numbering, headings, and footnotes are applied by the system — never type paragraph numbers yourself. Do NOT emit the caption, title, or signature block.',
  input_schema: {
    type: 'object' as const,
    properties: { body: BODY_ARRAY_SCHEMA },
    required: ['body'],
  },
};

interface CaptionInput {
  court: string;
  plaintiff: string;
  plaintiffDesignation: string;
  defendant: string;
  defendantDesignation: string;
  caseNumber: string;
  caseFor?: string;
}
interface BodyBlock {
  type: 'heading' | 'item' | 'text';
  level?: number;
  text: string;
  align?: 'left' | 'center' | 'right' | 'justified';
}
interface PleadingContent {
  caption: CaptionInput;
  title: string;
  subtitle?: string;
  body: BodyBlock[];
}

// ── Inline parsing ──────────────────────────────────────────────────────────

/** Parse **bold**, *italic*, __underline__ into Book Antiqua runs. */
function emphasisRuns(text: string, size = SIZE): TextRun[] {
  const out: TextRun[] = [];
  const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*))/g;
  let last = 0; let m: RegExpExecArray | null;
  const push = (t: string, o: { bold?: boolean; italics?: boolean; underline?: boolean } = {}) => {
    if (t) out.push(new TextRun({ text: t, font: FONT, size, bold: o.bold, italics: o.italics, underline: o.underline ? {} : undefined }));
  };
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) push(text.slice(last, m.index));
    if (m[2]) push(m[2], { bold: true, italics: true });
    else if (m[3]) push(m[3], { bold: true });
    else if (m[4]) push(m[4], { underline: true });
    else if (m[5]) push(m[5], { italics: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) push(text.slice(last));
  if (out.length === 0) push(text);
  return out;
}

/**
 * Parse a block's text into runs, turning [[fn:...]] tokens into real footnote
 * references. Footnotes are registered into `fns` with a running id.
 */
function inlineRuns(
  text: string,
  fns: Record<number, { children: Paragraph[] }>,
  counter: { n: number },
): (TextRun | FootnoteReferenceRun)[] {
  const runs: (TextRun | FootnoteReferenceRun)[] = [];
  const re = /\[\[fn:([\s\S]+?)\]\]/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(...emphasisRuns(text.slice(last, m.index)));
    counter.n += 1;
    const id = counter.n;
    fns[id] = { children: [new Paragraph({ children: emphasisRuns(m[1].trim(), SIZE_FN), spacing: { after: 0 } })] };
    runs.push(new FootnoteReferenceRun(id));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(...emphasisRuns(text.slice(last)));
  return runs;
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justified: AlignmentType.JUSTIFIED,
};

// ── Layout ──────────────────────────────────────────────────────────────────

function captionElements(c: CaptionInput): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const center = (runs: TextRun[], after = 0) => new Paragraph({ children: runs, alignment: AlignmentType.CENTER, spacing: { after, line: 240, lineRule: LineRuleType.AUTO } });
  const t = (s: string, o: { bold?: boolean; italics?: boolean } = {}) => new TextRun({ text: s, font: FONT, size: SIZE, bold: o.bold, italics: o.italics });

  out.push(center([t('REPUBLIC OF THE PHILIPPINES', { bold: true })]));
  for (const line of c.court.split('\n')) out.push(center([t(line.trim().toUpperCase(), { bold: true })]));
  out[out.length - 1] = center([t(c.court.split('\n').pop()!.trim().toUpperCase(), { bold: true })], 240);

  const cellPara = (runs: TextRun[], opts: { alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; indentLeft?: number } = {}) =>
    new Paragraph({ children: runs, alignment: opts.alignment ?? AlignmentType.LEFT, spacing: { after: opts.after ?? 0, line: 240, lineRule: LineRuleType.AUTO }, indent: opts.indentLeft ? { left: opts.indentLeft } : undefined });
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

  out.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [
      new TableCell({
        width: { size: 58, type: WidthType.PERCENTAGE },
        borders: { top: none, bottom: none, left: none, right: none },
        children: [
          cellPara([t(c.plaintiff.toUpperCase(), { bold: true }), t(',')]),
          cellPara([t(c.plaintiffDesignation + '.', { italics: true })], { after: 80, indentLeft: 720 }),
          cellPara([t('- versus -')], { alignment: AlignmentType.CENTER, after: 80 }),
          cellPara([t(c.defendant.toUpperCase(), { bold: true }), t(',')]),
          cellPara([t(c.defendantDesignation + '.', { italics: true })], { indentLeft: 720 }),
        ],
      }),
      new TableCell({
        width: { size: 42, type: WidthType.PERCENTAGE },
        borders: { top: none, bottom: none, left: { style: BorderStyle.SINGLE, size: 8, color: '000000' }, right: none },
        children: [
          cellPara([t(c.caseNumber || '__________', { bold: true })], { after: 80, indentLeft: 240 }),
          ...(c.caseFor ? [cellPara([t('For: ', { bold: true }), t(c.caseFor)], { indentLeft: 240 })] : []),
        ],
      }),
    ] })],
  }));

  out.push(new Paragraph({ children: [t('x' + '- '.repeat(28) + 'x')], spacing: { after: 240, before: 60, line: 240, lineRule: LineRuleType.AUTO } }));
  return out;
}

function signatureElements(params: PleadingParams): Paragraph[] {
  const t = (s: string, o: { bold?: boolean; italics?: boolean } = {}) => new TextRun({ text: s, font: FONT, size: SIZE, bold: o.bold, italics: o.italics });
  const right = (runs: TextRun[], after = 0) => new Paragraph({ children: runs, alignment: AlignmentType.RIGHT, spacing: { after, line: 240, lineRule: LineRuleType.AUTO } });
  const out: Paragraph[] = [];
  out.push(new Paragraph({ children: [t('RESPECTFULLY SUBMITTED.', { bold: true })], spacing: { before: 240, after: 240, line: 240, lineRule: LineRuleType.AUTO } }));
  out.push(right([t(params.firmName.toUpperCase(), { bold: true })]));
  out.push(right([t('Counsel for the ' + (params.matterContext.clientName ? params.matterContext.clientName : 'party'))], 160));
  out.push(right([t('By:')], 240));
  out.push(right([t((params.signerName || '____________________').toUpperCase(), { bold: true })]));
  if (params.signerPosition) out.push(right([t(params.signerPosition)]));
  out.push(right([t('Roll No. ______; IBP No. ______')]));
  out.push(right([t('PTR No. ______; MCLE Compliance No. ______')]));
  return out;
}

function bodyElements(blocks: BodyBlock[], fns: Record<number, { children: Paragraph[] }>, counter: { n: number }): Paragraph[] {
  const out: Paragraph[] = [];
  for (const b of blocks) {
    const runs = inlineRuns(b.text ?? '', fns, counter);
    if (b.type === 'heading') {
      out.push(new Paragraph({
        children: runs,
        heading: (b.level ?? 1) >= 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120, line: 240, lineRule: LineRuleType.AUTO },
      }));
    } else if (b.type === 'item') {
      out.push(new Paragraph({
        children: runs,
        numbering: { reference: NUMBERING_REF, level: Math.max(0, Math.min(2, b.level ?? 0)) },
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 360, line: 240, lineRule: LineRuleType.AUTO },
      }));
    } else {
      out.push(new Paragraph({
        children: runs,
        alignment: b.align ? ALIGN[b.align] : AlignmentType.JUSTIFIED,
        spacing: { after: 360, line: 240, lineRule: LineRuleType.AUTO },
      }));
    }
  }
  return out;
}

function buildDocx(content: PleadingContent, params: PleadingParams): Promise<Buffer> {
  const fns: Record<number, { children: Paragraph[] }> = {};
  const counter = { n: 0 };

  const title = new Paragraph({
    children: [new TextRun({ text: content.title.toUpperCase(), font: FONT, size: SIZE, bold: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: content.subtitle ? 60 : 360, line: 240, lineRule: LineRuleType.AUTO },
  });
  const subtitle = content.subtitle
    ? [new Paragraph({ children: emphasisRuns(content.subtitle), alignment: AlignmentType.CENTER, spacing: { after: 360, line: 240, lineRule: LineRuleType.AUTO } })]
    : [];

  const children = [
    ...captionElements(content.caption),
    title,
    ...subtitle,
    ...bodyElements(content.body ?? [], fns, counter),
    ...signatureElements(params),
  ];

  const doc = new Document({
    creator: 'Lumilex',
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE }, paragraph: { spacing: { after: 360, line: 240, lineRule: LineRuleType.AUTO } } },
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: FONT, size: SIZE, bold: true, allCaps: true }, paragraph: { alignment: AlignmentType.CENTER } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: FONT, size: SIZE, bold: true }, paragraph: { alignment: AlignmentType.LEFT } },
      ],
    },
    numbering: {
      config: [{
        reference: NUMBERING_REF,
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 1440, hanging: 432 } } } },
          { level: 2, format: LevelFormat.DECIMAL, text: '%1.%2.%3.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 2160, hanging: 504 } } } },
        ],
      }],
    },
    footnotes: Object.keys(fns).length > 0 ? fns : undefined,
    sections: [{ properties: { page: { size: PAGE, margin: MARGIN } }, children }],
  });

  return Packer.toBuffer(doc).then((u) => Buffer.from(u));
}

// ── AI drafting ─────────────────────────────────────────────────────────────


async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err: unknown) {
      const is429 = err instanceof Error && (err.message.includes('429') || err.message.includes('rate_limit'));
      if (!is429 || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, Math.min(60_000, (2 ** attempt) * 15_000)));
    }
  }
  throw new Error('Unreachable');
}

const pleadingGuide = (firmName: string) => `You are a Philippine litigation associate at ${firmName} drafting a court pleading.

DRAFTING STANDARDS:
- Write TIGHT. Each numbered paragraph makes ONE point in 2–4 sentences. Prefer several short, well-organized paragraphs over a few long ones. No padding, no throat-clearing.
- Active voice; concise sentences. "v." not "vs."; italicize case titles and non-English words; "Php" for currency; dates day-month-year (e.g. 1 January 2025); Oxford comma.
- EVERY legal citation goes in a FOOTNOTE — never in-text. Put a [[fn:...]] token immediately after the sentence it supports, e.g. ...is settled.[[fn:*People v. Dizon*, G.R. No. 123456, 1 January 2020.]] Use *Id.* and *supra* for repeats.
- Number argument paragraphs as "item" blocks (the system applies 1., 1.1., 1.1.1. automatically) — do NOT type the numbers yourself.
- Use "heading" blocks for the standard sections (e.g. PREFATORY STATEMENT, STATEMENT OF THE CASE / FACTS, ARGUMENTS / DISCUSSION, PRAYER).
- Open with a short unnumbered "text" lead-in (e.g. the party "by counsel, respectfully states:"). End with a PRAYER ("WHEREFORE, premises considered, ...").
- Do NOT output the caption, the title, or the signature block in the body — those are added by the system. Do NOT include any letterhead.`;

/**
 * Run one forced-tool emit as a streamed request and return the tool input plus
 * whether it hit the token cap. Streaming keeps large max_tokens under the SDK's
 * HTTP timeout; thinking is disabled because adaptive thinking is incompatible
 * with forcing a specific tool.
 */
async function runEmit(
  claude: Anthropic,
  opts: {
    model: string;
    maxTokens: number;
    tools: Anthropic.Tool[];
    toolName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userContent: any[];
    attachFileId: string | null;
  },
): Promise<{ input: Record<string, unknown>; truncated: boolean }> {
  const createParams = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    thinking: { type: 'disabled' as const },
    tools: opts.tools,
    tool_choice: { type: 'tool' as const, name: opts.toolName },
    messages: [{ role: 'user' as const, content: opts.userContent }],
  };
  const response = opts.attachFileId
    ? await withRetry(() => claude.beta.messages.stream({ ...createParams, betas: ['files-api-2025-04-14'] }).finalMessage())
    : await withRetry(() => claude.messages.stream(createParams).finalMessage());
  const truncated = response.stop_reason === 'max_tokens';
  const blocks = response.content as Array<{ type: string; input?: unknown }>;
  const toolUse = blocks.find((b) => b.type === 'tool_use');
  if (!toolUse || !toolUse.input || typeof toolUse.input !== 'object') {
    throw new Error('Model did not return a structured pleading');
  }
  return { input: toolUse.input as Record<string, unknown>, truncated };
}

const MAX_CONTINUATIONS = 2;

export async function generatePleadingDocx(params: PleadingParams): Promise<{ buffer: Buffer; truncated: boolean }> {
  const claude = await anthropicFor({ firmId: params.firmId, feature: 'drafting' });
  const model = params.model ?? 'claude-sonnet-5';
  const maxTokens = params.maxTokens ?? 24_000;

  const matterInfo = [
    params.matterContext.caseTitle && `Case title: ${params.matterContext.caseTitle}`,
    params.matterContext.name && `Matter: ${params.matterContext.name}`,
    params.matterContext.caseNumber && `Case number: ${params.matterContext.caseNumber}`,
    params.matterContext.court && `Court: ${params.matterContext.court}`,
    params.matterContext.clientName && `Client (our party): ${params.matterContext.clientName}`,
    params.matterContext.parties && `Parties: ${params.matterContext.parties}`,
  ].filter(Boolean).join('\n');

  const respondingTo = params.respondingTo;
  const respondingBlock = respondingTo
    ? respondingTo.claudeFileId
      ? `RESPONSIVE PLEADING — DOCUMENT BEING RESPONDED TO:\nThe document titled "${respondingTo.name}" is ATTACHED. You are drafting in RESPONSE to it: address and rebut its specific arguments, allegations, and prayer point by point.`
      : `RESPONSIVE PLEADING — DOCUMENT BEING RESPONDED TO ("${respondingTo.name}"):\n${respondingTo.text}\n\nYou are drafting in RESPONSE to the document above: address and rebut its specific arguments, allegations, and prayer point by point.`
    : '';

  const taskBlock = params.reviseFrom
    ? `REVISE THIS EXISTING DRAFT of a "${params.documentType}". Apply the revision below, then RE-EMIT THE COMPLETE pleading (caption, full body, and prayer) via emit_pleading. Preserve everything the revision does not ask you to change — structure, facts, the party's positions, and every existing citation — and keep the firm's house style.

REVISION REQUESTED:
${params.reviseFrom.instruction}

CURRENT DRAFT (full text):
${params.reviseFrom.currentText}`
    : `DRAFT THIS: a "${params.documentType}". Produce a complete, well-structured ${params.documentType} ready for a lawyer's review.`;

  const basePrompt = `${pleadingGuide(params.firmName)}

${taskBlock}

MATTER CONTEXT:
${matterInfo || 'No specific matter context provided.'}

${respondingBlock ? `${respondingBlock}\n` : ''}
${params.groundingContext ? `${params.groundingContext}\n\nUse the matter brief above as the factual basis. Apply the firm knowledge. Where the matter's own record is provided, stay consistent with positions already taken; never copy another matter's specific facts.\n` : ''}
${params.additionalInstructions ? `ADDITIONAL INSTRUCTIONS:\n${params.additionalInstructions}` : ''}`;

  const attachFileId = respondingTo?.claudeFileId ?? null;
  const contentWith = (directive: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr: any[] = [];
    if (attachFileId) arr.push({ type: 'document', source: { type: 'file', file_id: attachFileId }, title: respondingTo?.name });
    arr.push({ type: 'text', text: `${basePrompt}\n\n${directive}` });
    return arr;
  };

  // Step 1 — caption + title only. This output is tiny, so it can never be lost
  // to token-cap truncation the way it was when the caption shared one tool call
  // with the (much larger) body and the model emitted the body first.
  const cap = await runEmit(claude, {
    model,
    maxTokens: 1_500,
    tools: [EMIT_CAPTION_TOOL],
    toolName: 'emit_caption',
    userContent: contentWith('First, produce ONLY the caption (court + parties) and the title, by calling the emit_caption tool. Do not draft the body yet.'),
    attachFileId,
  });
  const capInput = cap.input as { caption?: CaptionInput; title?: string; subtitle?: string };
  if (!capInput.caption || !capInput.title) {
    throw new Error('Pleading caption generation failed');
  }

  // Step 2 — the body, with the same continuation loop for long pleadings.
  const bodyRes = await runEmit(claude, {
    model,
    maxTokens,
    tools: [EMIT_BODY_TOOL],
    toolName: 'emit_pleading_body',
    userContent: contentWith('Now produce ONLY the body of the pleading (no caption, title, or signature block) by calling the emit_pleading_body tool. Open with the unnumbered lead-in and end with the PRAYER.'),
    attachFileId,
  });
  const content: PleadingContent = {
    caption: capInput.caption,
    title: capInput.title,
    subtitle: capInput.subtitle,
    body: toolArray<BodyBlock>((bodyRes.input as { body?: unknown }).body),
  };
  if (content.body.length === 0) {
    throw new Error('Pleading response missing body');
  }

  // Continue past the token cap: re-run emitting ONLY the remaining body blocks
  // and append them, so a long pleading reaches its PRAYER and closing. Merging
  // structured blocks (not DOCX) keeps numbering and footnotes continuous — the
  // DOCX is built once from the merged body below.
  let truncated = bodyRes.truncated;
  for (let pass = 0; truncated && pass < MAX_CONTINUATIONS; pass++) {
    const tail = content.body
      .slice(-3)
      .map((b) => `[${b.type}${b.level != null ? ` L${b.level}` : ''}] ${b.text}`)
      .join('\n');
    const contPrompt = `${pleadingGuide(params.firmName)}\n\nThe pleading below was cut off before it was finished. Continue it: emit ONLY the body blocks that come AFTER the last block shown. Do not repeat any block already written, and do not re-emit the caption, title, or signature. Make sure the pleading reaches its PRAYER (WHEREFORE, premises considered, ...) and closing lead-in.\n\nLAST BLOCKS WRITTEN SO FAR:\n${tail}\n\nReturn the continuation by calling the emit_pleading_body tool.`;
    const cont = await runEmit(claude, {
      model,
      maxTokens,
      tools: [EMIT_BODY_TOOL],
      toolName: 'emit_pleading_body',
      userContent: [{ type: 'text', text: contPrompt }],
      attachFileId: null,
    });
    const contBody = toolArray<BodyBlock>((cont.input as { body?: unknown }).body);
    if (contBody.length > 0) content.body.push(...contBody);
    truncated = cont.truncated;
  }

  const buffer = await buildDocx(content, params);
  console.log(`[pleading-generator] Built pleading (${(buffer.length / 1024).toFixed(1)}KB, ${content.body.length} blocks${truncated ? ', TRUNCATED' : ''})`);
  return { buffer, truncated };
}
