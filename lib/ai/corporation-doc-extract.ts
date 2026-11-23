import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { uploadToClaudeFiles, deleteClaudeFile, fileBlock } from '@/lib/ai/claude';
import type { CorporationFileCategory } from '@/types/corporations';

const MODEL = 'claude-haiku-4-5';

export {
  EXTRACTABLE_CATEGORIES,
  isExtractable,
  type ExtractableCategory,
  type ExtractedFields,
  type DocumentExtraction,
} from '@/lib/ai/corporation-doc-extract-shape';
import {
  EXTRACTABLE_CATEGORIES,
  type ExtractableCategory,
  type ExtractedFields,
  type DocumentExtraction,
} from '@/lib/ai/corporation-doc-extract-shape';

const DATE_FIELDS = new Set([
  'secRegistrationDate',
  'birCorDate',
  'businessPermitIssuedDate',
  'businessPermitExpiryDate',
  'sssRegistrationDate',
  'philhealthRegistrationDate',
  'pagibigRegistrationDate',
]);

const COMPANY_TYPES = new Set(['Stock', 'Non-Stock', 'OPC', 'Partnership']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function buildSystemPrompt(category: ExtractableCategory): string {
  const spec = EXTRACTABLE_CATEGORIES[category];
  const fieldLines = spec.fields.map((f) => `  "${f}": string|null`).join(',\n');
  return `You read Philippine corporate registration documents and extract their facts. This document was filed as: ${spec.label}. It is usually a scan.

${spec.guidance}

Return ONLY valid JSON, no markdown fences:

{
  "isExpectedDocument": true|false,
${fieldLines},
  "notes": "One short sentence on anything ambiguous or unreadable. Empty string if clean."
}

Rules:
- Set "isExpectedDocument" to false if this is not a ${spec.label}. When false, set every field to null.
- Transcribe identifiers character-for-character. Do NOT normalise punctuation or fix apparent typos.
- All dates must be ISO format YYYY-MM-DD.
- Use null for anything you cannot read with confidence. Never guess a number or a date.`;
}

/**
 * Read the registration facts off a corporate document.
 *
 * Goes through Claude's Files API rather than local text extraction: these
 * documents are routinely scans, which pdf-parse returns as empty text.
 */
export async function extractCorporationDocument(
  firmId: string,
  category: ExtractableCategory,
  buffer: Buffer,
  fileName: string,
): Promise<DocumentExtraction> {
  const ctx = { firmId, feature: 'ai_analysis' } as const;
  const claude = await anthropicFor(ctx);

  const fileId = await uploadToClaudeFiles(ctx, buffer, fileName);
  try {
    const response = await claude.beta.messages.create({
      model: MODEL,
      max_tokens: 1024,
      betas: ['files-api-2025-04-14'],
      system: buildSystemPrompt(category),
      messages: [{
        role: 'user',
        content: [
          fileBlock(fileId, fileName),
          { type: 'text', text: `Document: "${fileName}"\n\nExtract the registration facts.` },
        ],
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type from Claude');
    let jsonText = content.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const parsed = JSON.parse(jsonText);

    const fields: ExtractedFields = {};
    for (const field of EXTRACTABLE_CATEGORIES[category].fields) {
      fields[field] = cleanField(field, (parsed as Record<string, unknown>)[field]);
    }

    return {
      category,
      isExpectedDocument: parsed.isExpectedDocument === true,
      fields,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    };
  } finally {
    await deleteClaudeFile(ctx, fileId);
  }
}

export function cleanField(field: string, value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : null;
  if (!s || s.toLowerCase() === 'null') return null;
  if (DATE_FIELDS.has(field)) {
    return ISO_DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
  }
  if (field === 'companyType') return COMPANY_TYPES.has(s) ? s : null;
  return s;
}

/** True when the extraction produced at least one usable value. */
export function hasAnyField(extraction: DocumentExtraction): boolean {
  return Object.values(extraction.fields).some((v) => v !== null);
}

/**
 * Corporate names for comparison: case, punctuation and suffix spelling all
 * vary between what the client proposed and what SEC printed
 * ("Tritone Entertainment Management, Inc." vs "... Management Inc.").
 */
export function normalizeCorporateName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .replace(/\b(incorporated|inc)\b/g, 'inc')
    .replace(/\b(corporation|corp)\b/g, 'corp')
    .replace(/\b(company|co)\b/g, 'co')
    .replace(/\bone person corp\b/g, 'opc')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does the extracted name correspond to a name the firm was already expecting?
 *
 * Gates the automatic path for the SEC COR only. The approval chain renames the
 * client and cascades that name across the denormalized finance tables, so a
 * misread name would propagate into invoices and billing bundles. A name that
 * matches something already on the record is safe to apply unattended; a
 * surprise is not.
 */
export function matchesExpectedName(extracted: string, expected: (string | null | undefined)[]): boolean {
  const target = normalizeCorporateName(extracted);
  if (!target) return false;
  return expected.some((e) => e && normalizeCorporateName(e) === target);
}

/**
 * Only the SEC COR applies itself. The post-incorporation documents always
 * prefill a confirmation dialog: a misread TIN or permit number is quiet and
 * hard to notice later, and unlike the COR there's no name to sanity-check the
 * reading against.
 */
export function autoAppliesOnUpload(category: CorporationFileCategory): boolean {
  return category === 'SEC COR';
}
