// Legal codes in the Library: their vocabulary, free of Supabase and React.
//
// A code is one Library page (kind 'legal_code'); its provisions are rows in
// code_provisions, each with a version history. Anchors and links are
// computable from the code id and provision number alone, so a citation can
// be linked from anywhere without a lookup.

export const LEGAL_CODE_KIND = 'legal_code';

export type CodeUnit = 'article' | 'section';
export type ProvisionStatus = 'in_force' | 'repealed';
export type ProvisionChange = 'original' | 'amended' | 'inserted' | 'repealed' | 'renumbered';

export interface CodeMeta {
  id: string;
  title: string;
  /** The citation's short title. House style never abbreviates a code. */
  shortTitle: string;
  instrument: string;
  enactedOn: string | null;
  effectiveOn: string | null;
  unit: CodeUnit;
  edition: string;
  sourceLabel: string;
  sourceUrl: string;
  position: number;
}

/** The codes the Library carries, in display order. */
export const CODES: Record<string, CodeMeta> = {
  labor: {
    id: 'labor',
    title: 'Labor Code of the Philippines',
    shortTitle: 'Labor Code',
    instrument: 'Presidential Decree No. 442',
    enactedOn: '1974-05-01',
    effectiveOn: '1974-11-01',
    unit: 'article',
    edition: 'DOLE Edition 2022, as amended and renumbered (Department Advisory No. 01, s. 2015)',
    sourceLabel: 'Department of Labor and Employment',
    sourceUrl: 'https://dole.gov.ph/labor-code-of-the-philippines-2/',
    position: 10,
  },
  rcc: {
    id: 'rcc',
    title: 'Revised Corporation Code of the Philippines',
    shortTitle: 'Revised Corporation Code',
    instrument: 'Republic Act No. 11232',
    enactedOn: '2019-02-20',
    effectiveOn: null,
    unit: 'section',
    edition: 'As enacted, from the signed copy of the law',
    sourceLabel: 'Republic Act No. 11232 (signed copy)',
    sourceUrl: 'https://lawphil.net/statutes/repacts/ra2019/pdf/ra_11232_2019.pdf',
    position: 20,
  },
};

export function codeSlug(codeId: string): string {
  return `legal-code-${codeId}`;
}

export function unitAbbrev(unit: CodeUnit): string {
  return unit === 'article' ? 'art.' : 'sec.';
}

export function unitLabel(unit: CodeUnit): string {
  return unit === 'article' ? 'Article' : 'Section';
}

/** "Labor Code, art. 237" — the subsequent-citation form the style guide prescribes. */
export function provisionCitation(shortTitle: string, unit: CodeUnit, number: string): string {
  return `${shortTitle}, ${unitAbbrev(unit)} ${number}`;
}

/** The label a provision prints under: "Art. 237. [231]" or "Sec. 23.". */
export function provisionLabel(unit: CodeUnit, number: string, formerNumber?: string | null): string {
  const base = `${unit === 'article' ? 'Art.' : 'Sec.'} ${number}.`;
  return formerNumber ? `${base} [${formerNumber}]` : base;
}

/** Element id of a provision on its code's page: "art-266-a", "sec-23". */
export function provisionAnchor(unit: CodeUnit, number: string): string {
  return `${unit === 'article' ? 'art' : 'sec'}-${number.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}`;
}

/** Where a provision lives in the app: /dashboard/library/codes/labor/237. */
export function provisionHref(codeId: string, number?: string | null): string {
  return `/dashboard/library/codes/${codeId}${number ? `/${encodeURIComponent(number)}` : ''}`;
}

/**
 * Sort key for a provision number: "266" < "266-A" < "266-B" < "267".
 * Letters after the number sort as a fraction so the order survives
 * insertions between existing articles.
 */
export function numberSortKey(number: string): number {
  const m = /^(\d+)(?:-?([A-Z]+))?$/i.exec(number.trim());
  if (!m) return Number.MAX_SAFE_INTEGER;
  const base = Number(m[1]);
  if (!m[2]) return base;
  let frac = 0;
  let scale = 1 / 27;
  for (const ch of m[2].toUpperCase()) {
    frac += (ch.charCodeAt(0) - 64) * scale;
    scale /= 27;
  }
  return base + frac;
}

export const CHANGE_LABELS: Record<ProvisionChange, string> = {
  original: 'As enacted',
  amended: 'Amended',
  inserted: 'Inserted',
  repealed: 'Repealed',
  renumbered: 'Renumbered',
};

export interface ProvisionVersion {
  seq: number;
  change: ProvisionChange;
  number: string | null;
  heading: string | null;
  text: string | null;
  effectiveOn: string | null;
  instrument: string | null;
  instrumentSection: string | null;
  approvedOn: string | null;
  instrumentUrl: string | null;
  note: string | null;
}

/**
 * What a reader is told about a provision at a glance: the last change that
 * reached it, if any. A provision that only ever had its original text is
 * 'original'; a renumbering alone counts as a change.
 */
export function latestChange(versions: Pick<ProvisionVersion, 'seq' | 'change'>[]): ProvisionChange {
  const last = [...versions].sort((a, b) => b.seq - a.seq)[0];
  return last?.change ?? 'original';
}

/** One line for a change: "Amended by Republic Act No. 6715, sec. 3 (approved 2 March 1989)". */
export function describeChange(v: Pick<ProvisionVersion, 'change' | 'instrument' | 'instrumentSection' | 'approvedOn'>, fmt: (iso: string) => string): string {
  if (v.change === 'original') return 'As enacted';
  const by = v.instrument ? ` by ${v.instrument}${v.instrumentSection ? `, ${v.instrumentSection}` : ''}` : '';
  const when = v.approvedOn ? ` (approved ${fmt(v.approvedOn)})` : '';
  return `${CHANGE_LABELS[v.change]}${by}${when}`;
}

export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };

/**
 * Word-level comparison of two versions of a provision, for the history
 * panel. A longest-common-subsequence over word tokens, whitespace kept with
 * the word before it so the joined parts read naturally. Provisions are short
 * enough (a few hundred words) that the quadratic table is cheap.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.match(/\S+\s*/g) ?? [];
  const b = after.match(/\S+\s*/g) ?? [];
  const norm = (w: string) => w.trim();
  const n = a.length;
  const m = b.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = norm(a[i]) === norm(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(a[i]) === norm(b[j])) { push('same', b[j]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('removed', a[i++]);
    else push('added', b[j++]);
  }
  while (i < n) push('removed', a[i++]);
  while (j < m) push('added', b[j++]);
  return out;
}
