// Turns clean markdown from a government-issuance index page into structured
// issuance items via one Claude call, grounded in that source's type taxonomy
// and the firm's practice-area vocabulary.
//
// Output is validated item-by-item against the shared Zod schema; malformed
// items are dropped (and counted) rather than failing the whole extraction.

import { anthropicForPlatform } from '@/lib/ai/gate';
import {
  SOURCES,
  TYPE_TAXONOMY,
  PRACTICE_AREAS,
  type SourceKey,
} from '@/lib/issuances/sources';
import { issuanceItemSchema, type IssuanceItem } from '@/lib/issuances/schema';
import { manilaToday } from '@/lib/dates';

const MODEL = 'claude-haiku-4-5-20251001';

export interface ExtractResult {
  items: IssuanceItem[];
  /** Items Claude produced that failed schema validation and were discarded. */
  dropped: number;
  input_tokens: number;
  output_tokens: number;
}

export async function extractIssuances(
  source: SourceKey,
  markdown: string,
): Promise<ExtractResult> {
  const claude = await anthropicForPlatform('issuances_extraction');

  const meta = SOURCES[source];
  const types = TYPE_TAXONOMY[source];

  const today = manilaToday();

  const system = `You extract Philippine legal issuances from a government agency's index/listing page.

Source: ${meta.label} (${meta.shortLabel}).
Today's date: ${today}.

You are given the page's markdown. Identify every distinct issuance listed on it (circulars, orders, opinions, resolutions, decisions, etc.). For each one, emit a JSON object.

Return ONLY a JSON array (no markdown fences, no preamble). Each object:
{
  "type": one of EXACTLY these strings for this source: ${JSON.stringify(types)},
  "number": "the citation/docket number as printed (e.g. '2024-05', 'A.M. No. 21-08-09-SC'), or null if the listing shows none",
  "title": "the issuance's title or headline, trimmed",
  "subject": "a short subject line if distinct from the title, else null",
  "date_issued": "YYYY-MM-DD if a date is shown, else null",
  "date_effective": "YYYY-MM-DD if an effectivity date is shown, else null",
  "summary": "a 1-3 sentence summary if the listing provides descriptive text, else null",
  "source_url": "the absolute URL of THIS issuance's own detail page — i.e. the href of the link on the listing that points to this specific item. Use the listing/index page URL (${meta.url}) ONLY as a last resort when the item has no dedicated link of its own",
  "pdf_url": "the absolute URL of the direct PDF file for this issuance (a link ending in .pdf or a clearly file-serving link), else null",
  "practice_areas": array drawn ONLY from ${JSON.stringify(PRACTICE_AREAS)} — the areas this issuance plausibly affects; [] if unclear,
  "ai_confidence": "high" | "medium" | "low" — your confidence that this is a real, correctly-parsed issuance,
  "ai_flags": array of short strings noting any problems (e.g. "missing number", "ambiguous date"); [] if none
}

Rules:
- "type" MUST be one of the listed strings verbatim. If an item doesn't fit any, pick the closest and add an ai_flag "type-approximated" with lower confidence.
- source_url must be item-specific: each issuance on the listing is almost always a hyperlink to its own page or PDF — capture that per-item href. Do NOT put the same index-page URL on every item; if you find yourself doing that, look again for the individual links. Flag "no-item-link" and fall back to the index URL only when an item genuinely has no link.
- Absolute URLs only. If the page shows a relative link, resolve it against the source domain (${meta.url}).
- Never invent a number, date, or PDF link that isn't in the source. Use null.
- Dates strictly YYYY-MM-DD. If a date is shown as text (e.g. "May 3, 2024"), convert it. If you cannot parse it, use null.
- If the page shows navigation/boilerplate and no actual issuances, return [].
- Do not fabricate issuances to fill the array.
- Return AT MOST the 30 most recent issuances, newest first. Listing pages often carry years of history; this cron runs daily and already has the older ones, so only the newest matter. Do not attempt to emit the entire archive.`;

  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 16384,
    system,
    messages: [
      {
        role: 'user',
        content: `Page markdown for ${meta.label}:\n\n${markdown.slice(0, 120000)}`,
      },
    ],
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn(`[issuances/extract] output truncated for source "${source}"`);
  }

  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new Error(`Unexpected response type from Claude for source "${source}"`);
  }

  const rawItems = parseJsonArray(content.text, source);

  const items: IssuanceItem[] = [];
  let dropped = 0;
  for (const raw of rawItems) {
    const parsed = issuanceItemSchema.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
    else dropped++;
  }

  return {
    items,
    dropped,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}

function parseJsonArray(raw: string, source: SourceKey): unknown[] {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  // Claude occasionally wraps the array in prose despite instructions; grab the
  // outermost [...] block if a bare parse fails.
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        /* fall through to object salvage */
      }
    }
    // Truncated output (hit max_tokens mid-array): salvage every complete
    // top-level object so a huge listing still yields its parsed prefix
    // instead of nothing.
    const salvaged = salvageObjects(text.slice(start >= 0 ? start : 0));
    if (salvaged.length) {
      console.warn(
        `[issuances/extract] recovered ${salvaged.length} object(s) from truncated output for source "${source}"`,
      );
      return salvaged;
    }
    console.error(`[issuances/extract] could not parse JSON array for source "${source}"`);
    return [];
  }
}

/**
 * Extract every complete top-level `{...}` object from a (possibly truncated)
 * JSON array body. Tracks string/escape state so braces inside strings don't
 * throw off the depth count; a dangling final object that never closed is
 * simply dropped.
 */
function salvageObjects(s: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(s.slice(objStart, i + 1)));
        } catch {
          /* skip a malformed object */
        }
        objStart = -1;
      }
    }
  }
  return out;
}
