// The DOLE edition of the Labor Code (2022, renumbered) → articles and their history.
//
// The PDF has a clean text layer whose type sizes say what each run is:
// 16pt a Book heading, 14pt a Title, 12pt a Chapter, 9.5pt the articles,
// 6pt (9pt beside a heading) a footnote mark in the text, 8pt the page
// number, and 5.5pt the footnotes with 3.5pt numbers. A paragraph opens
// indented; its continuation lines start at the margin. The footnotes are
// the edition's record of each change ("As amended by Sec. 3 of R.A. No.
// 6715 (1989)"), and the bracketed number after an article's own is its
// number before the 2015 renumbering. Pure and tested; the parse script
// reads the PDF with pdfjs and feeds the runs in.

import { titleCase } from '@/lib/rules/model';
import type { CodeFileVersion } from '@/lib/codes/data';
import type { ProvisionChange } from '@/lib/codes/model';

export interface PdfRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DoleArticle {
  number: string;
  formerNumber: string | null;
  heading: string | null;
  text: string;
  path: string[];
  /** The footnotes marked on the article, in order, as printed. */
  footnotes: string[];
}

type Kind = 'book' | 'title' | 'chapter' | 'body' | 'mark' | 'page' | 'fnmark' | 'fn' | 'loose';

function kindOf(run: PdfRun): Kind {
  const h = run.height;
  const numeric = /^\d{1,3}$/.test(run.str.trim());
  if (h >= 15.5) return 'book';
  if (h >= 13.5) return 'title';
  if (h >= 11.5) return 'chapter';
  if (h >= 9.25) return 'body';
  // Only a bare number is a mark or a page number. The edition sets the odd word at another size
  // ("monetary" at 8pt in art. 110, part of a footnote at 6pt, the "th" of "13th"); such a run joins its line.
  if (!numeric && h >= 4.5 && h < 5.8) return 'fn';
  if (!numeric) return 'loose';
  if (h >= 8.75) return 'mark';
  if (h >= 7.5) return 'page';
  if (h >= 5.8) return 'mark';
  if (h >= 4.5) return 'fn';
  return 'fnmark';
}

interface Line { y: number; kind: Kind; x: number; runs: (PdfRun & { kind: Kind })[] }

/** Runs grouped into printed lines, top to bottom; a superscript mark joins the line it rides on. */
export function linesOf(runs: PdfRun[]): Line[] {
  const typed = runs.filter((r) => r.str.trim()).map((r) => ({ ...r, kind: kindOf(r) }));
  // Text first, so each mark can find the line it sits on.
  const anchors = typed.filter((r) => r.kind !== 'mark' && r.kind !== 'fnmark' && r.kind !== 'loose').sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const r of anchors) {
    const line = lines.find((l) => Math.abs(l.y - r.y) <= 1.5 && kindFamily(l.kind) === kindFamily(r.kind));
    if (line) line.runs.push(r);
    else lines.push({ y: r.y, kind: r.kind, x: r.x, runs: [r] });
  }
  for (const r of typed.filter((x) => x.kind === 'loose')) {
    const near = lines.filter((l) => Math.abs(l.y - r.y) <= 3).sort((x, y) => Math.abs(r.y - x.y) - Math.abs(r.y - y.y))[0];
    if (near) near.runs.push({ ...r, kind: near.kind });
  }
  for (const m of typed.filter((r) => r.kind === 'mark' || r.kind === 'fnmark')) {
    const family = m.kind === 'fnmark' ? 'fn' : 'text';
    const near = lines
      // A mark rides up to about half its line's height above the baseline; a heading's rides higher.
      .filter((l) => kindFamily(l.kind) === family && m.y - l.y >= -1 && m.y - l.y <= 0.65 * l.runs[0].height)
      .sort((a, b) => Math.abs(m.y - a.y) - Math.abs(m.y - b.y))[0];
    if (near) near.runs.push(m);
    else lines.push({ y: m.y, kind: m.kind === 'fnmark' ? 'fn' : 'body', x: m.x, runs: [m] });
  }
  for (const l of lines) {
    l.runs.sort((a, b) => a.x - b.x);
    l.x = l.runs[0].x;
    // A line's kind is its text's, not its marks'.
    l.kind = l.runs.find((r) => r.kind !== 'mark' && r.kind !== 'fnmark')?.kind ?? l.kind;
  }
  return lines.sort((a, b) => b.y - a.y || a.x - b.x);
}

function kindFamily(k: Kind): 'text' | 'fn' | 'page' {
  if (k === 'fn' || k === 'fnmark') return 'fn';
  if (k === 'page') return 'page';
  return 'text';
}

const MARK = (n: string) => `⟪${n}⟫`;
const MARK_RE = /\s*⟪(\d{1,3})⟫/g;

/** A line's text, a space where the runs leave a gap, marks kept as ⟪n⟫ so the article can collect them. */
function lineText(line: Line): string {
  let out = '';
  let end = -Infinity;
  for (const r of line.runs) {
    const piece = r.kind === 'mark' || r.kind === 'fnmark' ? MARK(r.str.trim()) : r.str;
    if (out && r.x - end > 0.8 && !/\s$/.test(out) && !/^\s/.test(piece)) out += ' ';
    out += piece;
    end = r.x + r.width;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function joinWrapped(prev: string, next: string): string {
  // A line ending in a hyphen is a hyphenated compound broken at the margin ("government-" / "owned").
  return prev.endsWith('-') ? prev + next : `${prev} ${next}`;
}

function headingLabel(kind: 'Book' | 'Title' | 'Chapter', raw: string): string {
  const s = raw.replace(MARK_RE, '').replace(/\s+/g, ' ').trim();
  const m = new RegExp(`^${kind}\\s+([\\w-]+)\\s*[-–—]\\s*(.+)$`, 'i').exec(s);
  if (m) return `${kind} ${m[1]} — ${titleCase(m[2])}`;
  return titleCase(s);
}

const ART_RE = /^ART\.\s*(\d{1,3}(?:-[A-Z])?)\.\s*(?:\[(\d{1,3}(?:-[A-Z])?)\]\s*)?(.*)$/;

/**
 * Every article of the Code from "ART. 1." on, with the divisions above it
 * and the footnotes marked on it. The front matter and the table of
 * contents come before the first article and are skipped.
 */
export function parseDoleLaborCode(pages: PdfRun[][]): DoleArticle[] {
  const footnotes = new Map<string, string>();
  let lastFootnote: string | null = null;
  type Para = { text: string; kind: 'book' | 'title' | 'chapter' | 'body' };
  const paras: Para[] = [];
  let started = false;
  // Set while the last thing read was a heading, so a heading that wraps joins its first line.
  let headingOpen = false;

  for (const runs of pages) {
    const lines = linesOf(runs);
    if (!started) {
      const first = lines.findIndex((l) => l.kind === 'body' && /^ART\.\s*1\./.test(lineText(l)));
      if (first === -1) continue;
      started = true;
    }
    // Left and right pages sit at different margins; a paragraph's first line is indented from this page's.
    const margin = Math.min(...lines.filter((l) => l.kind === 'body').map((l) => l.x));
    let prevY: number | null = null;
    for (const l of lines) {
      const text = lineText(l);
      if (l.kind === 'page') continue;
      if (l.kind === 'fn' || l.kind === 'fnmark') {
        const m = /^⟪(\d{1,3})⟫\s*(.*)$/.exec(text);
        if (m) { lastFootnote = m[1]; footnotes.set(m[1], m[2]); }
        else if (lastFootnote) footnotes.set(lastFootnote, `${footnotes.get(lastFootnote)} ${text}`.trim());
        continue;
      }
      const kind = l.kind === 'book' || l.kind === 'title' || l.kind === 'chapter' ? l.kind : 'body';
      const last = paras[paras.length - 1];
      if (kind !== 'body') {
        // A heading that wraps continues on the next line at the same size.
        if (last && last.kind === kind && headingOpen) last.text = `${last.text} ${text}`;
        else paras.push({ text, kind });
        headingOpen = true;
        prevY = null;
        continue;
      }
      headingOpen = false;
      // A paragraph opens indented; a line at the margin continues the one above, across a page break too.
      // Within a page, paragraphs are set apart by extra space (about 21pt against 12pt between wrapped lines).
      // At the top of a page there is no gap to read, so an unindented line continues the paragraph the last page ended on.
      const wrapped = prevY === null ? l.x < margin + 8 : prevY - l.y < 16;
      const continues = last?.kind === 'body' && wrapped && !ART_RE.test(text);
      prevY = l.y;
      if (continues) last.text = joinWrapped(last.text, text);
      else paras.push({ text, kind: 'body' });
    }
  }

  const out: DoleArticle[] = [];
  let book: string | null = null;
  let title: string | null = null;
  let chapter: string | null = null;
  let cur: (DoleArticle & { marks: string[] }) | null = null;
  const flush = () => {
    if (!cur) return;
    const marks = [...cur.text.matchAll(MARK_RE)].map((m) => m[1]);
    cur.footnotes = [...new Set([...cur.marks, ...marks])].map((n) => footnotes.get(n)).filter((f): f is string => !!f);
    cur.text = cur.text.replace(MARK_RE, '').trim();
    out.push({ number: cur.number, formerNumber: cur.formerNumber, heading: cur.heading, text: cur.text, path: cur.path, footnotes: cur.footnotes });
    cur = null;
  };

  for (const p of paras) {
    if (p.kind === 'book') {
      flush();
      book = /^PRELIMINARY TITLE/i.test(p.text) ? 'Preliminary Title' : headingLabel('Book', p.text);
      title = null;
      chapter = null;
      continue;
    }
    if (p.kind === 'title') { flush(); title = headingLabel('Title', p.text); chapter = null; continue; }
    if (p.kind === 'chapter') { flush(); chapter = headingLabel('Chapter', p.text); continue; }
    const art = ART_RE.exec(p.text.replace(/^(ART\.\s*\d{1,3}(?:-[A-Z])?\.)\s*⟪\d{1,3}⟫/, '$1'));
    if (art) {
      flush();
      const rest = art[3];
      const dash = rest.search(/\s[–—]\s|\s[–—]$|^[–—]\s/);
      const headPart = dash === -1 ? rest : rest.slice(0, dash);
      const body = dash === -1 ? '' : rest.slice(dash).replace(/^\s*[–—]\s*/, '');
      const headMarks = [...headPart.matchAll(MARK_RE)].map((m) => m[1]);
      const heading = headPart.replace(MARK_RE, '').trim().replace(/\.$/, '') || null;
      cur = {
        number: art[1],
        formerNumber: art[2] ?? null,
        heading,
        text: body,
        path: [book, title, chapter].filter((x): x is string => !!x),
        footnotes: [],
        marks: headMarks,
      };
      continue;
    }
    if (cur) cur.text = cur.text ? `${cur.text}\n${p.text}` : p.text;
  }
  flush();
  return out;
}

// ── History from the footnotes ──

const INSTRUMENT_RE = /(?:R\.A\.|Republic Act)\s*(?:No\.)?\s*\d+|(?:P\.D\.|Presidential Decree)\s*(?:No\.)?\s*\d+(?:-[A-Z])?|(?:B\.P\.|Batas Pambansa)\s*Blg\.\s*\d+|(?:E\.O\.|Executive Order)\s*(?:No\.)?\s*\d+/g;

export function instrumentName(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  const num = /(\d+(?:-[A-Z])?)$/.exec(s)?.[1] ?? '';
  if (/^(R\.A\.|Republic Act)/.test(s)) return `Republic Act No. ${num}`;
  if (/^(P\.D\.|Presidential Decree)/.test(s)) return `Presidential Decree No. ${num}`;
  if (/^(B\.P\.|Batas Pambansa)/.test(s)) return `Batas Pambansa Blg. ${num}`;
  return `Executive Order No. ${num}`;
}

export interface FootnoteChange {
  change: Extract<ProvisionChange, 'amended' | 'inserted'>;
  instrument: string;
  section: string | null;
  year: number | null;
  note: string;
}

// A footnote records a change to its article only when it opens by saying so. Elsewhere the edition
// mentions amendments to other laws ("See Sec. 23 of R.A. No. 8042, as amended by R.A. 10022"), which are not this article's history.
const STATES_CHANGE_RE = /^(?:As (?:further )?amended|Amended|As added|Added|Inserted|Renumbered and amended|(?:First|Second|Third|Last|The (?:first|second|third|last)) (?:paragraph|sentence)|Pars?\.|Paragraphs?|Sub-?paragraphs?|This (?:article|Article|provision))(?=[\s,.])/;
// The editorial sentences that follow the statement of the change.
const AFTER_STATEMENT_RE = /\.\s+(?=(?:See|Take note|Note|Cf\.|Under|In|The|This|It|Prior|Previously|Also|Before|Formerly)\b)/;

/**
 * The changes a footnote records for its article: each law named in the
 * footnote's opening statement, with the section of it that made the change
 * and the year beside it. "As amended by Sec. 3 of R.A. No. 6715 (1989)",
 * "Inserted as a new provision pursuant to Sec. 2 of R.A. No. 9481 (2007)",
 * "First paragraph of this Article was repealed by Sec. 5 … of R.A. No. 7796"
 * (a paragraph repealed is the article amended).
 */
export function changesInFootnote(note: string): FootnoteChange[] {
  const text = note.replace(/\s+/g, ' ').trim();
  if (!STATES_CHANGE_RE.test(text)) return [];
  const statement = text.split(AFTER_STATEMENT_RE)[0];
  const out: FootnoteChange[] = [];
  let from = 0;
  let lastVerb: string | undefined;
  for (const m of statement.matchAll(INSTRUMENT_RE)) {
    const before = statement.slice(from, m.index);
    const after = statement.slice(m.index + m[0].length, m.index + m[0].length + 200);
    from = m.index + m[0].length;
    // The Code itself, named in an amending law's title ("…Amending for the Purpose Presidential Decree No. 442").
    if (instrumentName(m[0]) === 'Presidential Decree No. 442') continue;
    // The verb is the clause's own, or the last one's when this law continues the same sentence ("… by Sec. 1 of P.D. No. 1368 and Sec. 2 of P.D. No. 1641").
    const own = [...before.matchAll(/\b(amended|inserted|added|repealed)\b/gi)].at(-1)?.[1].toLowerCase();
    const verb = own ?? (/\.\s+[A-Z]/.test(before) ? undefined : lastVerb);
    if (!verb) continue;
    lastVerb = verb;
    const sec = /(Secs?\.\s*[\w()\s,-]*?\w\)?|Sections?\s+[\w()\s,-]*?\w\)?)\s*(?:\([^)]*\)\s*)?(?:,|of)\s*$/i.exec(before);
    const year = /^[^()]{0,160}?\((\d{4})\)/.exec(after) ?? /^\s*\((\d{4})\)/.exec(after);
    out.push({
      change: (verb === 'inserted' || verb === 'added') && !/amended/i.test(before) ? 'inserted' : 'amended',
      instrument: instrumentName(m[0]),
      section: sec ? sec[1].replace(/\s+/g, ' ').replace(/^Sections?\s+/i, 'sec. ').replace(/^Secs?\.\s*/i, 'sec. ').trim() : null,
      year: year ? Number(year[1]) : null,
      note,
    });
  }
  return out;
}

/** One change per law: a law named in two footnotes, or twice in one, is one change, with the fullest details found. */
export function mergeChanges(changes: FootnoteChange[]): FootnoteChange[] {
  const byLaw = new Map<string, FootnoteChange>();
  for (const c of changes) {
    const prev = byLaw.get(c.instrument);
    if (!prev) { byLaw.set(c.instrument, { ...c }); continue; }
    prev.section = prev.section ?? c.section;
    prev.year = prev.year ?? c.year;
    if (c.change === 'inserted') prev.change = 'inserted';
    if (!prev.note.includes(c.note)) prev.note = `${prev.note}\n\n${c.note}`;
  }
  return [...byLaw.values()];
}

export const RENUMBERING = {
  instrument: 'DOLE Department Advisory No. 01, s. 2015',
  year: 2015,
  note: 'Renumbered under Department Advisory No. 01, series of 2015, implementing Sec. 5 of Republic Act No. 10151 (2011), which directed the renumbering of the Labor Code.',
};

/**
 * An article's versions, oldest first, from its footnotes and its former
 * number. The text in force is known; earlier wordings are not in the
 * edition, so every version before the last change to the words has no
 * text. A renumbering leaves the words as they were.
 */
export function laborVersions(a: DoleArticle, enactedOn: string, sourceUrl: string): CodeFileVersion[] {
  const changes = mergeChanges(a.footnotes.flatMap(changesInFootnote));
  const commentary = a.footnotes.filter((f) => changesInFootnote(f).length === 0);
  type Step = { change: ProvisionChange; instrument: string | null; section: string | null; year: number | null; note: string | null; number: string };
  const steps: Step[] = [];
  const inserted = changes.find((c) => c.change === 'inserted');
  const former = a.formerNumber && a.formerNumber !== a.number ? a.formerNumber : null;
  const oldNumber = former ?? a.number;
  if (!inserted) steps.push({ change: 'original', instrument: null, section: null, year: 1974, note: null, number: oldNumber });
  for (const c of [...changes].sort((x, y) => (x.year ?? 0) - (y.year ?? 0))) {
    steps.push({ change: c.change, instrument: c.instrument, section: c.section, year: c.year, note: c.note, number: oldNumber });
  }
  if (former) {
    // Renumbered in 2015; later amendments carry the new number.
    const at = steps.findIndex((s) => (s.year ?? 0) > RENUMBERING.year);
    const step: Step = { change: 'renumbered', instrument: RENUMBERING.instrument, section: null, year: RENUMBERING.year, note: RENUMBERING.note, number: a.number };
    if (at === -1) steps.push(step); else steps.splice(at, 0, step);
    for (let i = (at === -1 ? steps.length : at + 1); i < steps.length; i++) steps[i].number = a.number;
  }
  const lastWords = steps.reduce((acc, s, i) => (s.change !== 'renumbered' ? i : acc), 0);
  return steps.map((s, i) => ({
    seq: i,
    change: s.change,
    number: s.number,
    heading: i >= lastWords ? a.heading : null,
    text: i >= lastWords ? a.text : null,
    effectiveOn: s.change === 'original' ? '1974-11-01' : null,
    instrument: s.instrument ? `${s.instrument}${s.year && s.change !== 'renumbered' ? ` (${s.year})` : ''}` : null,
    instrumentSection: s.section,
    approvedOn: s.change === 'original' ? enactedOn : null,
    instrumentUrl: s.change === 'original' ? sourceUrl : null,
    note: [s.note, i === steps.length - 1 && commentary.length ? `Editor’s notes in the DOLE edition: ${commentary.join(' ')}` : null].filter(Boolean).join('\n\n') || null,
  }));
}
