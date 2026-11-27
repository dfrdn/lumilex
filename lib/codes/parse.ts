// Code text → provisions.
//
// The input is a law's text one paragraph per line, as transcribed from its
// signed copy, with "=== PAGE n ===" markers where the printed pages break.
// Divisions are "TITLE IV" / "CHAPTER II" lines followed by their names in
// capitals; a provision opens with "SEC. 23. Heading. – text" (or
// "SECTION 1." for the first). Pure and tested; the import script feeds it
// the file and writes the rows.

import { titleCase } from '@/lib/rules/model';

export interface ParsedProvision {
  number: string;
  heading: string | null;
  text: string;
  /** Divisions above, outermost first: "Title XIII — Special Corporations", "Chapter III — One Person Corporations". */
  path: string[];
}

const PAGE_RE = /^=== PAGE [^=]*===$/;
const DIVISION_RE = /^(TITLE|CHAPTER|BOOK|PART)\s+([IVXLC]+|\d+|[A-Z]+)$/;
const SECTION_RE = /^(?:SECTION|SEC\.)\s+(\d+(?:-[A-Z])?)\.\s+(.*)$/;
// A line of a division's name: capitals, digits and punctuation only.
const CAPS_RE = /^[A-Z0-9][A-Z0-9 ,;:'’“”"()\-–—&./]*$/;
const SENTENCE_END_RE = /[.;:!?”"’)]$/;

/**
 * Lines with page breaks mended: a paragraph the page cut mid-sentence is
 * rejoined, and the markers are dropped.
 */
export function mendPages(text: string): string[] {
  const out: string[] = [];
  let atBreak = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (PAGE_RE.test(line)) { atBreak = true; continue; }
    const prev = out[out.length - 1];
    if (atBreak && prev !== undefined && continuesAcrossBreak(prev, line)) {
      out[out.length - 1] = prev.endsWith('-') && /^[a-z]/.test(line) ? prev.slice(0, -1) + line : `${prev} ${line}`;
    } else {
      out.push(line);
    }
    atBreak = false;
  }
  return out;
}

function continuesAcrossBreak(prev: string, next: string): boolean {
  if (SECTION_RE.test(next) || DIVISION_RE.test(next) || /^\([a-z0-9]+\)\s/.test(next)) return false;
  return !SENTENCE_END_RE.test(prev) || /^[a-z]/.test(next);
}

function divisionLabel(kind: string, num: string, name: string): string {
  const k = kind.charAt(0) + kind.slice(1).toLowerCase();
  return name ? `${k} ${num} — ${titleCase(name)}` : `${k} ${num}`;
}

/** "Title of the Code. – This Code…" → heading and opening text, split at the first dash after the heading. */
export function splitSectionOpening(rest: string): { heading: string | null; text: string } {
  const m = /^(.+?\.)\s*[–—-]\s+(.*)$/.exec(rest);
  if (!m) return { heading: null, text: rest };
  return { heading: m[1].replace(/\.$/, '').trim(), text: m[2].trim() };
}

/**
 * The provisions of a code written in sections, from its enacting clause to
 * its last section. Lines before the first division are the enacting
 * formalities; lines after the closing "Approved," are the signatures.
 */
export function parseSectionedCode(text: string): ParsedProvision[] {
  const lines = mendPages(text);
  const out: ParsedProvision[] = [];
  // Open divisions by level; a TITLE closes any CHAPTER under the previous title.
  let title: string | null = null;
  let chapter: string | null = null;
  let subheads: string[] = [];
  let started = false;
  let cur: ParsedProvision | null = null;
  const body: string[] = [];

  const flush = () => {
    if (!cur) return;
    cur.text = body.join('\n').trim();
    out.push(cur);
    cur = null;
    body.length = 0;
  };
  const pathNow = () => [title, chapter, ...subheads].filter((x): x is string => !!x);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const div = DIVISION_RE.exec(line);
    if (div) {
      started = true;
      flush();
      // The division's name: the capitals lines that follow, the first of them.
      const names: string[] = [];
      while (i + 1 < lines.length && CAPS_RE.test(lines[i + 1]) && !DIVISION_RE.test(lines[i + 1]) && !SECTION_RE.test(lines[i + 1])) {
        names.push(lines[++i]);
      }
      const label = divisionLabel(div[1], div[2], names[0] ?? '');
      if (div[1] === 'CHAPTER') chapter = label;
      else { title = label; chapter = null; }
      // Any further capitals line is a heading under the division ("DEFINITIONS AND CLASSIFICATIONS").
      subheads = names.slice(1).map(titleCase);
      continue;
    }
    if (!started) continue;
    const sec = SECTION_RE.exec(line);
    if (sec) {
      flush();
      const { heading, text } = splitSectionOpening(sec[2]);
      cur = { number: sec[1], heading, text: '', path: pathNow() };
      body.push(text);
      continue;
    }
    if (/^Approved,?$/.test(line)) { flush(); break; }
    if (cur) body.push(line);
  }
  flush();
  return out;
}

/** Numbers that should be there and are not: 1…max with none skipped. */
export function numberingGaps(provisions: { number: string }[]): number[] {
  const seen = new Set(provisions.map((p) => parseInt(p.number, 10)).filter(Number.isFinite));
  const max = Math.max(0, ...seen);
  const gaps: number[] = [];
  for (let n = 1; n <= max; n++) if (!seen.has(n)) gaps.push(n);
  return gaps;
}
