/**
 * DOCX placeholder substitution for user-uploaded Word templates.
 *
 * Replaces {{key}} tokens in document.xml, headers, and footers while
 * handling Word's habit of splitting placeholders across multiple <w:r>/<w:t>
 * runs when the template is edited.
 */

import JSZip from 'jszip';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Word often splits a typed {{placeholder}} across multiple <w:r>/<w:t> runs
// (spell-check, autocorrect, or mid-edit formatting changes). Merge split
// braces and strip XML tags between matched {{ and }} so literal-string
// substitution finds the placeholder.
function normalizePlaceholderRuns(xml: string): string {
  let result = xml.replace(/\{(?:\s*<[^>]+>)+\s*\{/g, '{{');
  result = result.replace(/\}(?:\s*<[^>]+>)+\s*\}/g, '}}');
  result = result.replace(/\{\{[^{}]+?\}\}/g, (m) => m.replace(/<[^>]+>/g, ''));
  return result;
}

// Word soft-break sequence. Inserted between escaped lines so a single
// {{placeholder}} can render multi-line content (attendee lists, agenda items)
// without forcing callers to invent multiple placeholders.
const WORD_SOFT_BREAK = '</w:t><w:br/><w:t>';

function applySubstitutions(
  xml: string,
  values: Record<string, string>,
  multilineKeys?: Set<string>,
): string {
  let result = normalizePlaceholderRuns(xml);
  for (const [key, value] of Object.entries(values)) {
    let escaped = escapeXml(value);
    if (multilineKeys?.has(key)) {
      escaped = escaped.split('\n').join(WORD_SOFT_BREAK);
    }
    result = result.split(`{{${key}}}`).join(escaped);
  }
  return result;
}

export interface SubstituteOptions {
  /**
   * Keys whose value contains `\n`-separated lines that should render as Word
   * soft line breaks inside a single paragraph. Use for attendee lists,
   * agenda items, and other list-like content that a flat {{placeholder}}
   * cannot otherwise express.
   */
  multilineKeys?: string[];
}

/**
 * Substitute placeholders in a DOCX buffer.
 * Opens the DOCX as a ZIP, replaces {{key}} patterns in document.xml plus
 * any headers and footers.
 */
export async function substituteDocxPlaceholders(
  templateBuffer: Buffer,
  values: Record<string, string>,
  options: SubstituteOptions = {},
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBuffer);
  const docXmlFile = zip.file('word/document.xml');

  if (!docXmlFile) {
    throw new Error('Invalid DOCX template: missing document.xml');
  }

  const multilineKeys = options.multilineKeys?.length
    ? new Set(options.multilineKeys)
    : undefined;

  const docXml = applySubstitutions(await docXmlFile.async('string'), values, multilineKeys);

  for (const filename of Object.keys(zip.files)) {
    if (filename.match(/word\/(header|footer)\d*\.xml$/)) {
      const xml = applySubstitutions(await zip.files[filename].async('string'), values, multilineKeys);
      zip.file(filename, xml);
    }
  }

  zip.file('word/document.xml', docXml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return Buffer.from(buffer);
}
