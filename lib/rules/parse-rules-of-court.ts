// Rules of Court text → sections.
//
// Three publications, three layouts. The 2019 Rules of Civil Procedure PDF
// carries the full text of Rules 1–71 (and Rule 144) followed by a
// comparative table we ignore; its pages leave running headers and page
// numbers in the extracted text. The Revised Rules of Criminal Procedure
// (Rules 110–127) is a clean run that opens with an editorial summary. The
// 2019 Rules on Evidence (Rules 128–133) come from lawphil's HTML because the
// Supreme Court PDF is a two-column 1989/2019 comparison whose columns
// interleave when extracted. Everything here is pure and tested; the import
// script feeds it the text and writes the rows.

export type RuleSource = 'civil' | 'criminal' | 'evidence';

export interface ParsedSection {
  source: RuleSource;
  /** Part heading above the rule, e.g. "SPECIAL CIVIL ACTIONS", when the text carries one. */
  part: string | null;
  rule: number;
  ruleTitle: string;
  /** Sub-heading inside the rule, e.g. "B. DOCUMENTARY EVIDENCE". */
  heading: string | null;
  section: number;
  title: string;
  text: string;
}

export const SOURCE_META: Record<RuleSource, { label: string; short: string; issuance: string; effective: string; url: string }> = {
  civil: {
    label: '2019 Amendments to the 1997 Rules of Civil Procedure',
    short: 'Rules of Civil Procedure',
    issuance: 'A.M. No. 19-10-20-SC',
    effective: '2020-05-01',
    url: 'https://sc.judiciary.gov.ph/wp-content/uploads/2022/08/2019-rules-of-civil-procedure.pdf',
  },
  criminal: {
    label: 'Revised Rules of Criminal Procedure, as amended',
    short: 'Rules of Criminal Procedure',
    issuance: 'A.M. No. 00-5-03-SC',
    effective: '2000-12-01',
    url: 'https://lawphil.net/courts/rules/rc_110-127_crim.html',
  },
  evidence: {
    label: '2019 Amendments to the 1989 Revised Rules on Evidence',
    short: 'Rules on Evidence',
    issuance: 'A.M. No. 19-08-15-SC',
    effective: '2020-05-01',
    url: 'https://lawphil.net/courts/rules/am_19-08-15-sc_2019.html',
  },
};

const RULE_RE = /^RULE\s+(\d+)\s*$/;
const SECTION_RE = /^(?:Section|SECTION|Sec\.)\s+(\d+)\.\s*(.*)$/;
// A sub-part inside a rule: "A. OBJECT (REAL) EVIDENCE", "1. Original Document Rule".
const SUBHEAD_RE = /^(?:[A-Z]\.|\d\.)\s*\S/;

const CIVIL_NOISE: RegExp[] = [
  /^\d{1,3}$/,
  /^Rules?\s+\d+(-\d+|\s+and\s+\d+)?$/,
  /2019 Amendments to the 1997 Rules of Civil Procedure/i,
  /^\(A\.M\. No\. 19-10-20-SC\)$/,
  /^X X X/,
];

/** The civil PDF sets a drop-cap "S" on its own line: "S" / "ection 2. The body." */
export function joinDropCaps(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'S' && /^ection\s+\d+\./i.test(lines[i + 1] ?? '')) {
      out.push(`S${lines[i + 1]}`);
      i++;
    } else {
      out.push(lines[i]);
    }
  }
  return out;
}

function isAllCaps(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && letters === letters.toUpperCase();
}

/** The lines of the text that are the rules themselves, in order. */
export function relevantLines(source: RuleSource, raw: string): string[] {
  const lines = joinDropCaps(raw.split(/\r?\n/).map((l) => l.replace(/[ \t ]+/g, ' ').trim()));
  const startRule = source === 'civil' ? 1 : source === 'criminal' ? 110 : 128;
  const start = lines.findIndex((l) => RULE_RE.test(l) && Number(l.match(RULE_RE)![1]) === startRule);
  let body = start >= 0 ? lines.slice(start) : lines;

  if (source === 'civil') {
    // The comparative table that follows Rule 144 restarts at RULE 6.
    const r144 = body.findIndex((l) => /^RULE\s+144\s*$/.test(l));
    if (r144 >= 0) {
      const restart = body.findIndex((l, i) => i > r144 && /^RULE\s+6\s*$/.test(l));
      if (restart > 0) body = body.slice(0, restart);
    }
    body = body.filter((l) => !CIVIL_NOISE.some((re) => re.test(l)));
  }
  // Part headings sit one or two lines above a RULE line; keep the closest.
  return body.filter((l) => l.length > 0);
}

/** Amendment brackets ("[R]ules") and PDF ligature gaps ("defi ned"). */
export function cleanText(s: string): string {
  return s
    .replace(/\uFFFD/g, ' ')
    .replace(/\[([A-Za-z])\]/g, '$1')
    .replace(/\bfi (?=[a-z])/g, 'fi')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .trim();
}

const TITLE_SPLIT_RE = /\.?\s*[–—±]\s*|\.?\s-\s|\.\s*-(?=\s*[A-Z(])/;

const MAX_TITLE_CHARS = 160;

/**
 * "Title of the Rules. – These Rules shall…" → title + first line of text.
 * lawphil drops the dash on some sections ("Original of document. (a) An
 * original…"); then the title is the first sentence when it is short.
 */
export function splitTitle(raw: string): { title: string; text: string } {
  const rest = raw.replace(/\s+\./g, '.');
  const m = TITLE_SPLIT_RE.exec(rest);
  if (m && m.index > 0 && m.index <= MAX_TITLE_CHARS) {
    return {
      title: cleanText(rest.slice(0, m.index)).replace(/\.$/, ''),
      text: cleanText(rest.slice(m.index + m[0].length)),
    };
  }
  const period = /^(.{3,120}?[a-z)])\.\s+(?=[(A-Z])/.exec(rest);
  if (period) return { title: cleanText(period[1]), text: cleanText(rest.slice(period[0].length)) };
  return { title: '', text: cleanText(rest) };
}

/** Lines are PDF-wrapped; keep a paragraph break only where the text plainly starts one. */
function joinBody(lines: string[]): string {
  const paras: string[] = [];
  for (const line of lines) {
    const startsItem = /^(\([a-z0-9]{1,3}\)|\d{1,2}\.)\s/.test(line);
    const prev = paras[paras.length - 1];
    if (!prev || startsItem || /[:;]$/.test(prev)) paras.push(line);
    else paras[paras.length - 1] = `${prev} ${line}`;
  }
  return paras.map(cleanText).filter(Boolean).join('\n');
}

export interface RuleHeader {
  source: RuleSource;
  part: string | null;
  rule: number;
  title: string;
  /** How many sections the text carries; 0 for a rule the amendments deleted. */
  sectionCount: number;
}

export function parseRulesText(source: RuleSource, raw: string): ParsedSection[] {
  return parseRules(source, raw).sections;
}

export function parseRules(source: RuleSource, raw: string): { rules: RuleHeader[]; sections: ParsedSection[] } {
  const lines = relevantLines(source, raw);
  const out: ParsedSection[] = [];
  const rules: RuleHeader[] = [];

  let part: string | null = null;
  let pendingCaps: string[] = [];
  let rule = 0;
  let ruleTitle = '';
  let awaitingTitle = false;
  let heading: string | null = null;
  let current: { section: number; title: string; body: string[]; head: string | null; headLines: number } | null = null;

  const settleHead = () => {
    if (!current || current.head === null) return;
    const { title, text } = splitTitle(current.head);
    current.title = title;
    if (text) current.body.unshift(text);
    current.head = null;
  };
  const flush = () => {
    if (!current || rule === 0) { current = null; return; }
    settleHead();
    out.push({ source, part, rule, ruleTitle, heading, section: current.section, title: current.title, text: joinBody(current.body) });
    rules[rules.length - 1].sectionCount++;
    current = null;
  };

  // A caps line is a part heading when a RULE header follows within two
  // lines ("SPECIAL CIVIL ACTIONS" / "RULE 62"); otherwise it is a sub-heading
  // inside the current rule ("B. DOCUMENTARY EVIDENCE").
  const ruleFollows = (i: number) => RULE_RE.test(lines[i + 1] ?? '') || (isAllCaps(lines[i + 1] ?? '') && RULE_RE.test(lines[i + 2] ?? ''));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ruleMatch = RULE_RE.exec(line);
    if (ruleMatch) {
      flush();
      rule = Number(ruleMatch[1]);
      ruleTitle = '';
      awaitingTitle = true;
      heading = null;
      if (pendingCaps.length > 0) part = pendingCaps.join(' — ');
      pendingCaps = [];
      continue;
    }
    if (awaitingTitle) {
      ruleTitle = cleanText(line);
      awaitingTitle = false;
      rules.push({ source, part, rule, title: ruleTitle, sectionCount: 0 });
      continue;
    }
    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      flush();
      current = { section: Number(sectionMatch[1]), title: '', body: [], head: sectionMatch[2], headLines: 0 };
      pendingCaps = [];
      continue;
    }
    if (current && current.head !== null && !TITLE_SPLIT_RE.test(current.head) && current.headLines < 2) {
      // A long title wraps onto the next line before its dash.
      current.head = `${current.head} ${line}`;
      current.headLines++;
      continue;
    }
    if (isAllCaps(line) && (ruleFollows(i) || pendingCaps.length > 0)) {
      flush();
      pendingCaps.push(cleanText(line));
      continue;
    }
    const subhead = SUBHEAD_RE.test(line) && line.length < 80 && !/[.;,:]$/.test(line) && SECTION_RE.test(lines[i + 1] ?? '');
    if (isAllCaps(line) || subhead) {
      flush();
      heading = cleanText(line);
      continue;
    }
    if (current) {
      settleHead();
      current.body.push(line);
    }
  }
  flush();
  return { rules, sections: out };
}

// ── The 2019 Rules on Evidence: the PDF's 2019 column, indexed by lawphil ──

/** Letters and digits only: what two renderings of one section share. */
function skeleton(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Dice similarity over character 4-grams of the skeletons. */
export function skeletonSimilarity(a: string, b: string): number {
  const ga = skeleton(a);
  const gb = skeleton(b);
  if (ga.length < 4 || gb.length < 4) return ga === gb ? 1 : 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i <= s.length - 4; i++) {
      const g = s.slice(i, i + 4);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ma = grams(ga);
  const mb = grams(gb);
  let shared = 0;
  for (const [g, n] of ma) shared += Math.min(n, mb.get(g) ?? 0);
  return (2 * shared) / (ga.length - 3 + gb.length - 3);
}

/** Words the PDF splits at a ligature that lawphil happens not to use nearby. */
const LIGATURE_WORDS = ['verified', 'office', 'officer', 'offered', 'specified', 'certified', 'notified', 'identified', 'qualified', 'satisfied', 'justified', 'modified', 'testified', 'ratified', 'affidavit', 'affirmed', 'sufficient', 'efficient', 'official', 'difficult', 'different', 'defined', 'confined', 'affected', 'effect', 'effective', 'effects', 'offense', 'offenses', 'affirmative', 'fifteen', 'fifty', 'filed', 'filing', 'files', 'final', 'finally', 'finding', 'findings', 'first', 'five', 'fixed', 'fine', 'fines'];

const EVIDENCE_PDF_NOISE: RegExp[] = [
  /REVISED RULES ON EVIDENCE|2019 AMENDMENTS|A\.M\. NO\. 19-08-15-SC/i,
  /^\d{1,3}$/,
];

function mostlyNonAscii(line: string): boolean {
  const letters = line.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0) return false;
  return letters.replace(/[^A-Za-z]/g, '').length / letters.length < 0.7;
}

/**
 * The Supreme Court's evidence PDF is a two-column comparison whose columns
 * interleave in the extracted text, but every block is cleanly typeset. lawphil
 * has the 2019 text with correct section order and numbering, but runs amended
 * words together. So: take lawphil's sections as the index, and for each pick
 * the PDF block with the same number in the same rule whose skeleton (letters
 * and digits only) matches best. Below the threshold, lawphil's text stands.
 */
export function parseEvidenceFromComparative(pdfText: string, lawphilText: string, opts: { threshold?: number } = {}): ParsedSection[] {
  const threshold = opts.threshold ?? 0.6;
  const index = parseRulesText('evidence', lawphilText);
  // Every word lawphil uses anywhere in the rules: the vocabulary ligature
  // repairs are checked against.
  const vocabulary = new Set([...lawphilText.toLowerCase().split(/[^a-z]+/), ...LIGATURE_WORDS]);

  // The full text follows the table of contents: the second run of RULE 128.
  const all = pdfText.split(/\r?\n/).map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim());
  const ruleStarts = all.map((l, i) => (/^RULE\s+128\s*$/.test(l) ? i : -1)).filter((i) => i >= 0);
  const from = ruleStarts.length > 1 ? ruleStarts[1] : ruleStarts[0] ?? 0;
  const lines = all.slice(from).filter((l) => l && !EVIDENCE_PDF_NOISE.some((re) => re.test(l)) && !mostlyNonAscii(l));

  const blocks = new Map<string, string[]>();
  let rule = 0;
  let key: string | null = null;
  for (const line of lines) {
    const r = RULE_RE.exec(line);
    if (r) { rule = Number(r[1]); key = null; continue; }
    const sec = SECTION_RE.exec(line);
    if (sec && rule > 0) {
      key = `${rule}:${sec[1]}`;
      const list = blocks.get(key) ?? [];
      list.push(sec[2]);
      blocks.set(key, list);
      continue;
    }
    if (key) {
      const list = blocks.get(key)!;
      list[list.length - 1] = `${list[list.length - 1]}\n${line}`;
    }
  }

  return index.map((s) => {
    const candidates = blocks.get(`${s.rule}:${s.section}`) ?? [];
    let best: { text: string; score: number } | null = null;
    for (const c of candidates) {
      const score = skeletonSimilarity(c, `${s.title} ${s.text}`);
      // On a tie the later block wins: the 2019 column follows the 1989 one.
      if (!best || score >= best.score) best = { text: c, score };
    }
    if (!best || best.score < threshold) return s;
    // Re-parse the block with the ordinary parser so a wrapped title and the
    // paragraph breaks are handled the same way as everywhere else.
    const [parsed] = parseRulesText('evidence', `RULE ${s.rule}\n${s.ruleTitle}\nSection ${s.section}. ${best.text}`);
    if (!parsed) return s;
    return { ...s, title: healLigatures(parsed.title, vocabulary) || s.title, text: healLigatures(parsed.text, vocabulary) };
  });
}

/**
 * The PDF breaks words after an "ff", "fi" or "fl" ligature ("off ered",
 * "specifi ed"). Join the pair only when the joined word is one lawphil's
 * rendering of the same section actually uses, so "staff of" stays apart.
 */
export function healLigatures(text: string, known: Set<string>): string {
  return text.replace(/\b([A-Za-z]*(?:ff|fi|fl|ffi|ffl)) ([a-z]+)\b/g, (m, a: string, b: string) =>
    known.has(`${a}${b}`.toLowerCase()) ? `${a}${b}` : m,
  );
}

/** Sections whose numbering skips or repeats — what to eyeball after an import. */
export function numberingGaps(sections: ParsedSection[]): string[] {
  const gaps: string[] = [];
  const byRule = new Map<number, number[]>();
  for (const s of sections) {
    const list = byRule.get(s.rule) ?? [];
    list.push(s.section);
    byRule.set(s.rule, list);
  }
  for (const [rule, nums] of byRule) {
    nums.forEach((n, i) => {
      const expected = i === 0 ? 1 : nums[i - 1] + 1;
      if (n !== expected) gaps.push(`Rule ${rule}: expected Section ${expected}, got ${n}`);
    });
  }
  return gaps;
}
