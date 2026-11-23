/**
 * Backfill one firm's trademarks.goods_services from its own documents.
 *
 * For each mark with a class that has no goods or services, reads the papers
 * filed on it — the PDFs on its timeline (application, IPOPHL acknowledgment,
 * notices, DAUs) and any analysed document that names its application number —
 * and asks Claude for each class's goods or services as filed, with the passage
 * it was read from. A class is filled only when the passage is found in a document.
 * Claude is reached through the AI gate under the firm's `ai_analysis`, so a
 * firm that has not opted in is refused, as the live paths are.
 *
 * Usage:
 *   npx tsx scripts/backfill-trademark-goods-services.ts <firmIdOrSlug> --out <report.json>    # dry run
 *   npx tsx scripts/backfill-trademark-goods-services.ts <firmIdOrSlug> --apply <report.json>  # write a reviewed report
 *
 * Write the report outside the repository: it quotes the firm's documents.
 *
 * --apply takes any report in the same shape, e.g. one transcribed from the
 * WIPO Global Brand Database (set "origin" so the audit row says so).
 *
 * Needs Node 22 (supabase-js) and .env.local.
 */
import './load-env';
import { readFileSync, writeFileSync } from 'fs';
import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { anthropicFor } from '../lib/ai/gate';
import { parseJsonResponse } from '../lib/ai/json-response';

const MODEL = 'claude-sonnet-5-5';
/** The papers most likely to list the goods or services, best first. */
const PAPER_RANK = [/application/i, /acknowledg/i, /notice of (issuance|allowance)/i, /declaration of actual use|\bDAU\b/i, /registrability/i, /search report/i];
const MAX_PDFS = 5;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;

interface ClassFinding { cls: number; text: string | null; source: string | null; quote: string | null }
interface MarkReport { id: string; mark: string; number: string | null; classes: number[]; sources: string[]; findings: ClassFinding[]; notes: string; /** Where the report came from, for the audit row; the firm's documents when absent. */ origin?: string }

const rank = (name: string) => {
  const i = PAPER_RANK.findIndex((re) => re.test(name));
  return i === -1 ? PAPER_RANK.length : i;
};
const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

async function resolveFirm(requested: string | undefined): Promise<{ id: string; slug: string }> {
  const { data } = await getSupabase().from('firms').select('id, slug').order('slug');
  const firms = (data ?? []) as { id: string; slug: string }[];
  const hit = firms.find((f) => f.id === requested || f.slug === requested);
  if (!hit) {
    console.error(`No firm matching "${requested ?? ''}". Known firms: ${firms.map((f) => f.slug).join(', ') || '(none)'}`);
    process.exit(1);
  }
  return hit;
}

async function dryRun(firmId: string, outPath: string) {
  const claude = await anthropicFor({ firmId, feature: 'ai_analysis' });
  const s = getServiceDbForFirm(firmId);

  const { data: marks, error } = await s.from('trademarks').select('id, mark, classes, goods_services, reg_ir_no').order('mark');
  if (error) throw error;
  const reports: MarkReport[] = [];

  for (const t of marks ?? []) {
    const classes: number[] = t.classes ?? [];
    const have = (t.goods_services ?? {}) as Record<string, string>;
    const missing = classes.filter((c) => !have[String(c)]?.trim());
    if (missing.length === 0) continue;
    const mark = (t.mark ?? '').trim();
    const number: string | null = t.reg_ir_no?.trim() || null;

    // The mark's own timeline papers.
    const { data: tf } = await s.from('trademark_files').select('name, storage_path, mime_type, size_bytes').eq('trademark_id', t.id);
    const pdfs = (tf ?? [])
      .filter((f) => /pdf/i.test(f.mime_type ?? f.name) && (f.size_bytes ?? 0) <= MAX_PDF_BYTES)
      .sort((a, b) => rank(a.name) - rank(b.name))
      .slice(0, MAX_PDFS);

    // Analysed documents anywhere that name the application number.
    const texts: { name: string; text: string }[] = [];
    if (number) {
      const { data: fa } = await s.from('file_analyses')
        .select('attachment_name, extracted_text')
        .ilike('extracted_text', `%${number}%`)
        .limit(12);
      const seen = new Set(pdfs.map((p) => squash(p.name)));
      for (const d of (fa ?? []).sort((a, b) => rank(a.attachment_name ?? '') - rank(b.attachment_name ?? ''))) {
        const name = d.attachment_name ?? 'document';
        if (seen.has(squash(name)) || !d.extracted_text) continue;
        seen.add(squash(name));
        texts.push({ name, text: d.extracted_text.slice(0, 20_000) });
      }
    }
    let budget = MAX_TEXT_CHARS;
    const keptTexts = texts.filter((d) => (budget -= d.text.length) >= 0);

    const sources = [...pdfs.map((p) => p.name), ...keptTexts.map((d) => d.name)];
    if (sources.length === 0) {
      reports.push({ id: t.id, mark, number, classes, sources, findings: missing.map((cls) => ({ cls, text: null, source: null, quote: null })), notes: 'No documents found for this mark.' });
      console.log(`- ${mark} (${number}): no documents`);
      continue;
    }

    const content: any[] = [];
    const pdfTexts: string[] = [];
    for (const p of pdfs) {
      const { data } = await s.storage.from('files').download(p.storage_path);
      if (!data) continue;
      const buf = Buffer.from(await data.arrayBuffer());
      content.push({ type: 'text', text: `Document: ${p.name}` });
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') }, title: p.name });
      pdfTexts.push(p.name);
    }
    for (const d of keptTexts) content.push({ type: 'text', text: `Document: ${d.name}\n\n${d.text}` });
    content.push({
      type: 'text',
      text: `The trademark "${mark}"${number ? `, IPOPHL application/registration no. ${number}` : ''}, is filed in Nice classes ${missing.join(', ')}.

For each of those classes, give the goods or services exactly as they were filed or registered for this mark — the specification, not the class heading — copied word for word from the documents above. Prefer the application or IPOPHL's acknowledgment/notice over letters, search reports or analyses; if a later paper (e.g. a response to a registrability report or a DAU) amended or limited the specification, give the amended one and say so in "notes".

Only use text that is about this mark (other marks may appear in the same document). If no document states a class's goods or services, return null for it — never infer them from the class number.

Return ONLY JSON:
{"classes":[{"cls":<number>,"text":"<goods or services, verbatim>"|null,"source":"<document name>"|null,"quote":"<the shortest passage, verbatim, containing the text>"|null}],"notes":"<one or two sentences>"}`,
    });

    const res = await claude.messages.create({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content }] });
    const raw = res.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('');
    let parsed: { classes: ClassFinding[]; notes: string };
    try { parsed = parseJsonResponse(raw); } catch { parsed = { classes: [], notes: `Unparseable reply: ${raw.slice(0, 200)}` }; }

    // A class is kept only if its quote is found in a text document, or it came from a PDF (checked by hand in review).
    const textOf = new Map(keptTexts.map((d) => [d.name, squash(d.text)]));
    const findings = missing.map((cls) => {
      const f = parsed.classes?.find((c) => Number(c.cls) === cls);
      if (!f?.text?.trim()) return { cls, text: null, source: f?.source ?? null, quote: null };
      const hay = f.source ? textOf.get(f.source) : undefined;
      if (hay && f.quote && !hay.includes(squash(f.quote).slice(0, 80))) {
        return { cls, text: null, source: f.source, quote: `UNVERIFIED: ${f.quote}` };
      }
      return { cls, text: f.text.trim(), source: f.source ?? null, quote: f.quote ?? null };
    });
    reports.push({ id: t.id, mark, number, classes, sources, findings, notes: parsed.notes ?? '' });
    console.log(`- ${mark} (${number}): ${findings.filter((f) => f.text).length}/${missing.length} classes from ${sources.length} docs`);
  }

  writeFileSync(outPath, JSON.stringify(reports, null, 2));
  console.log(`\nWrote ${outPath}. Review it, delete or correct any finding, then run --apply ${outPath}.`);
}

async function apply(firmId: string, path: string) {
  const s = getServiceDbForFirm(firmId);
  const reports: MarkReport[] = JSON.parse(readFileSync(path, 'utf8'));
  for (const r of reports) {
    const fill = r.findings.filter((f) => f.text?.trim());
    if (fill.length === 0) continue;
    const { data: t } = await s.from('trademarks').select('goods_services').eq('id', r.id).single();
    const gs = { ...((t?.goods_services ?? {}) as Record<string, string>) };
    for (const f of fill) if (!gs[String(f.cls)]?.trim()) gs[String(f.cls)] = f.text!.trim();
    const { error } = await s.from('trademarks').update({ goods_services: gs }).eq('id', r.id);
    console.log(`${r.mark} (${r.number}): ${error ? `FAILED ${error.message}` : `classes ${fill.map((f) => f.cls).join(', ')}`}`);
    if (!error) {
      await s.from('audit_log').insert({
        firm_id: firmId,
        entity_type: 'Trademark', entity_id: r.id, entity_name: r.mark, action: 'updated',
        field_changed: 'goods_services', new_value: `Backfilled from ${r.origin ?? 'documents'}: classes ${fill.map((f) => f.cls).join(', ')}`,
        performed_by: 'system',
      });
    }
  }
}

async function main() {
  const [firmArg, flag, file] = process.argv.slice(2);
  if (!firmArg || !file || (flag !== '--out' && flag !== '--apply')) {
    console.log('Usage: <firmIdOrSlug> --out <report.json> | <firmIdOrSlug> --apply <report.json>');
    process.exit(1);
  }
  const firm = await resolveFirm(firmArg);
  if (flag === '--out') await dryRun(firm.id, file);
  else await apply(firm.id, file);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
