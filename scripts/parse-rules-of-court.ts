/**
 * Extract the Rules of Court from the Supreme Court's publications into
 * data/rules-of-court/sections.json, which scripts/import-rules-of-court.ts
 * loads into the database. Run locally; the PDFs are not committed.
 *
 *   npx tsx scripts/parse-rules-of-court.ts \
 *     --civil ~/Downloads/2019-rules-of-civil-procedure.pdf \
 *     --criminal ~/Downloads/Revised_Rules_of_Criminal_Procedure.pdf \
 *     --evidence ~/Downloads/2019-rules-on-evidence.pdf \
 *     [--evidence-lawphil ~/Downloads/am_19-08-15-sc_2019.html]   (fetched from lawphil when omitted)
 */
import { readFileSync, writeFileSync } from 'fs';
import { extractPdfText } from '@/lib/ai/pdf-text';
import { parseEvidenceFromComparative, parseRules, numberingGaps, type ParsedSection, type RuleHeader } from '@/lib/rules/parse-rules-of-court';

const LAWPHIL_EVIDENCE = 'https://lawphil.net/courts/rules/am_19-08-15-sc_2019.html';
const OUT = 'data/rules-of-court/sections.json';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function pdfText(path: string): Promise<string> {
  return (await extractPdfText(readFileSync(path))).text;
}

function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|tr|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—');
  return stripped.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}

async function main() {
  const civilPath = arg('civil');
  const criminalPath = arg('criminal');
  const evidencePath = arg('evidence');
  if (!civilPath || !criminalPath || !evidencePath) {
    console.error('Usage: --civil <pdf> --criminal <pdf> --evidence <pdf> [--evidence-lawphil <html>]');
    process.exit(1);
  }

  const civil = parseRules('civil', await pdfText(civilPath));
  const criminal = parseRules('criminal', await pdfText(criminalPath));

  const lawphilPath = arg('evidence-lawphil');
  const lawphilHtml = lawphilPath ? readFileSync(lawphilPath, 'utf8') : await (await fetch(LAWPHIL_EVIDENCE)).text();
  const lawphilText = htmlToText(lawphilHtml);
  const evidenceRules = parseRules('evidence', lawphilText).rules;
  const evidenceSections = parseEvidenceFromComparative(await pdfText(evidencePath), lawphilText);

  const out: { rules: RuleHeader[]; sections: ParsedSection[] } = {
    rules: [...civil.rules, ...criminal.rules, ...evidenceRules],
    sections: [...civil.sections, ...criminal.sections, ...evidenceSections],
  };
  for (const [name, secs] of [['civil', civil.sections], ['criminal', criminal.sections], ['evidence', evidenceSections]] as const) {
    const gaps = numberingGaps(secs);
    const empty = secs.filter((s) => !s.title || !s.text).length;
    console.log(`${name}: ${new Set(secs.map((s) => s.rule)).size} rules, ${secs.length} sections, ${gaps.length} numbering gaps, ${empty} empty`);
    for (const g of gaps) console.log('  gap:', g);
  }
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`wrote ${OUT}: ${out.rules.length} rules, ${out.sections.length} sections`);
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
