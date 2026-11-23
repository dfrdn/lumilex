import type { LetterParagraph } from '@/lib/docx/letter-body';
import { fillWording as fill } from '@/lib/letter-wording';
import { plain } from './letter';

/**
 * Report wording into the letter: the shared engine (lib/letter-wording.ts)
 * with the two things a report adds — values from the record never carry
 * markup, and a block field standing alone as a paragraph brings in a list
 * or a shared block.
 */

/** Fill a piece of report wording, with markup kept out of the values. */
export function fillWording(body: string, fields: Record<string, string>): string {
  return fill(body, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, plain(v).trim()])));
}

/**
 * Wording as letter paragraphs. A paragraph that is only one of `blockKeys`
 * is replaced by what `blocks` gives for it (nothing when it gives none);
 * lines starting "- " become numbered items.
 */
export function wordingToParagraphs(
  body: string,
  fields: Record<string, string>,
  blocks: (key: string) => LetterParagraph[],
  blockKeys: ReadonlySet<string>,
): LetterParagraph[] {
  const out: LetterParagraph[] = [];
  for (const raw of body.split(/\n\s*\n/)) {
    const p = raw.trim();
    if (!p) continue;
    const block = /^\{\{\s*(\w+)\s*\}\}$/.exec(p);
    if (block && blockKeys.has(block[1])) {
      out.push(...blocks(block[1]));
      continue;
    }
    const lines = p.split('\n');
    const items = lines.filter((l) => l.trim().startsWith('- '));
    const text = lines.filter((l) => !l.trim().startsWith('- ')).join(' ').trim();
    if (text) {
      const filled = fillWording(text, fields).replace(/\s+/g, ' ').trim();
      if (filled) out.push({ text: filled, style: 'BodyText' });
    }
    items.forEach((l, i) => {
      out.push({
        type: 'item',
        text: fillWording(l.trim().slice(2), fields).trim(),
        ...(i === items.length - 1 ? { spacing_after: 240 } : {}),
      });
    });
  }
  return out;
}
