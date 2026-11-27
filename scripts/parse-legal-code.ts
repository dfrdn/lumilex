/**
 * Turn a code's text into data/codes/<code>.json, which
 * scripts/import-legal-codes.ts loads. Run locally; sources are not committed.
 *
 *   npx tsx scripts/parse-legal-code.ts --code rcc --text ~/Downloads/ra11232-transcript.txt
 *   npx tsx scripts/parse-legal-code.ts --code labor --pdf ~/Downloads/labor-code-dole-2022.pdf
 *
 * --text: one paragraph per line with "=== PAGE n ===" markers (see
 * lib/codes/parse.ts); a code taken as enacted gets one version per
 * provision, its original text. --pdf: the DOLE edition of the Labor Code
 * (lib/codes/parse-dole.ts), whose footnotes give each article's history.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parseSectionedCode, numberingGaps } from '@/lib/codes/parse';
import { laborVersions, parseDoleLaborCode, type PdfRun } from '@/lib/codes/parse-dole';
import { CODES } from '@/lib/codes/model';
import type { CodeFile } from '@/lib/codes/data';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const PROVENANCE: Record<string, string> = {
  labor: 'Taken from the DOLE Edition 2022 of the Labor Code, as amended and renumbered (PDF text layer). Each article\'s history is the edition\'s own footnotes; wordings before the last amendment are not in the edition.',
  rcc: 'Transcribed from the signed copy of Republic Act No. 11232 (lawphil.net PDF scan), each disagreement with lawphil.net\'s HTML text checked against the scan.',
};

/**
 * Every page's text runs, with their position and type size. Read with the
 * pdf.js build that pdf-parse already bundles, so the parser adds no
 * dependency; the committed data/codes/labor.json was made with pdfjs-dist,
 * so check a re-parse against it word for word before importing it.
 */
async function pdfRuns(path: string): Promise<PdfRun[][]> {
  type TextItem = { str: string; transform: number[]; width: number; height: number };
  type PdfJs = {
    getDocument(src: { data: Uint8Array; verbosity?: number }): {
      promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: TextItem[] }> }> }>;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDocument } = require('pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js') as PdfJs;
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const pages: PdfRun[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.flatMap((it) => ('str' in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height }] : [])));
  }
  return pages;
}

function laborFile(pages: PdfRun[][]): CodeFile {
  const meta = CODES.labor;
  const articles = parseDoleLaborCode(pages);
  const gaps = numberingGaps(articles);
  if (gaps.length) console.warn(`labor: article numbers missing from the parse: ${gaps.join(', ')}`);
  return {
    code: 'labor',
    provenance: PROVENANCE.labor,
    provisions: articles.map((a) => ({
      number: a.number,
      formerNumber: a.formerNumber && a.formerNumber !== a.number ? a.formerNumber : null,
      heading: a.heading,
      text: a.text,
      path: a.path,
      status: 'in_force',
      versions: laborVersions(a, meta.enactedOn ?? '1974-05-01', meta.sourceUrl),
    })),
  };
}

function write(file: CodeFile) {
  mkdirSync('data/codes', { recursive: true });
  const out = `data/codes/${file.code}.json`;
  writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
  console.log(`${out}: ${file.provisions.length} provisions`);
}

async function main() {
  const code = arg('code');
  const textPath = arg('text');
  const pdfPath = arg('pdf');
  if (code === 'labor' && pdfPath) return write(laborFile(await pdfRuns(pdfPath)));
  if (!code || !CODES[code] || !textPath) {
    console.error(`Usage: --code rcc --text <file> | --code labor --pdf <file>`);
    process.exit(1);
  }
  const meta = CODES[code];
  if (meta.unit !== 'section') throw new Error(`${code} is written in articles; its parser is not this one`);

  const provisions = parseSectionedCode(readFileSync(textPath, 'utf8'));
  const gaps = numberingGaps(provisions);
  if (gaps.length) throw new Error(`${code}: sections missing from the parse: ${gaps.join(', ')}`);

  const file: CodeFile = {
    code,
    provenance: PROVENANCE[code] ?? '',
    provisions: provisions.map((p) => ({
      number: p.number,
      formerNumber: null,
      heading: p.heading,
      text: p.text,
      path: p.path,
      status: 'in_force',
      versions: [{
        seq: 0,
        change: 'original',
        number: p.number,
        heading: p.heading,
        text: p.text,
        effectiveOn: meta.effectiveOn,
        instrument: null,
        instrumentSection: null,
        approvedOn: meta.enactedOn,
        instrumentUrl: meta.sourceUrl,
        note: null,
      }],
    })),
  };

  write(file);
}

main().catch((err) => { console.error(err); process.exit(1); });
