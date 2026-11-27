/**
 * Load data/codes/<code>.json (made by scripts/parse-legal-code.ts) into one
 * firm's Library: one legal_codes row and one kb_pages row per code, one
 * code_provisions row per article or section with its versions, and — when
 * the firm keeps vectors (`ai_search`) — one embedding per provision for
 * Search. Idempotent: provisions are matched by (code, number); only
 * provisions whose text changed are re-embedded, and a provision's versions
 * are rewritten only when they changed. A provision dropped from the file is
 * reported, never deleted. Run it for every firm that should carry the codes.
 *
 *   npx tsx scripts/import-legal-codes.ts <firmIdOrSlug> [--code labor|rcc] [--dry-run] [--no-embed]
 *
 * The text is the law's, the same for every firm; the rows are per firm
 * because each code points at its page in that firm's Library and a review is
 * that firm's sign-off.
 */
import './load-env';
import { readFileSync, readdirSync } from 'fs';

const EMBED_CONCURRENCY = 4;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function main() {
  const { getSupabase } = await import('@/lib/supabase');
  const { getServiceDbForFirm } = await import('@/lib/tenancy/service-db');
  const { isFeatureAvailable } = await import('@/lib/firm/features');
  const { fetchAllRows } = await import('@/lib/supabase-paginate');
  const { generateEmbeddingsForEntity } = await import('@/lib/ai/embeddings');
  const { CODES, LEGAL_CODE_KIND, codeSlug, provisionCitation, unitLabel } = await import('@/lib/codes/model');
  type CodeFile = import('@/lib/codes/data').CodeFile;
  type CodeFileVersion = import('@/lib/codes/data').CodeFileVersion;

  const args = process.argv.slice(2);
  const firmRef = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--code');
  const only = args.includes('--code') ? args[args.indexOf('--code') + 1] : null;
  const dryRun = args.includes('--dry-run');

  if (!firmRef) {
    console.error('Usage: npx tsx scripts/import-legal-codes.ts <firmIdOrSlug> [--code labor|rcc] [--dry-run] [--no-embed]');
    process.exit(1);
  }
  const { data: firmRows } = await getSupabase().from('firms').select('id, slug').order('slug');
  const firms = (firmRows ?? []) as { id: string; slug: string }[];
  const firm = firms.find((f) => f.id === firmRef || f.slug === firmRef);
  if (!firm) {
    console.error(`No firm matching "${firmRef}". Known firms: ${firms.map((f) => f.slug).join(', ') || '(none)'}`);
    process.exit(1);
  }

  // Embedding sends the text to Voyage and stores a derived copy — the firm's
  // `ai_search` consent decides it, public text or not.
  const embed = !args.includes('--no-embed') && (await isFeatureAvailable(firm.id, 'ai_search'));
  if (!args.includes('--no-embed') && !embed) {
    console.log(`[import-codes] ${firm.slug} does not have ai_search on — importing without embeddings (keyword search still covers the provisions).`);
  }
  const supabase = getServiceDbForFirm(firm.id);

  const files = readdirSync('data/codes').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  for (const codeId of files.filter((c) => !only || c === only)) {
    const meta = CODES[codeId];
    if (!meta) throw new Error(`data/codes/${codeId}.json: no such code in lib/codes/model.ts`);
    const data = JSON.parse(readFileSync(`data/codes/${codeId}.json`, 'utf8')) as CodeFile;
    const tallies = { inserted: 0, updated: 0, unchanged: 0, versionsRewritten: 0, embedded: 0 };
    const toEmbed: { id: number; text: string; metadata: Record<string, unknown> }[] = [];

    // The Library page: a preface saying where the text came from; the provisions render from their rows.
    const slug = codeSlug(codeId);
    const content = data.provenance ? `<p>${esc(data.provenance)}</p>` : '';
    const summary = `${meta.instrument} · ${data.provisions.length} ${unitLabel(meta.unit).toLowerCase()}s · ${meta.edition}`;
    const pageRow = {
      kind: LEGAL_CODE_KIND,
      title: meta.title,
      content_md: content,
      content_format: 'html',
      summary,
      jurisdiction: 'Philippines',
      status: 'published',
      generated_by: 'manual',
      author_name: meta.sourceLabel,
      visible_to_roles: null,
    };
    let pageId = 0;
    const { data: existingPage } = await supabase.from('kb_pages').select('id, title, content_md, summary').eq('slug', slug).maybeSingle();
    if (existingPage) {
      pageId = existingPage.id;
      const changed = existingPage.title !== meta.title || existingPage.content_md !== content || existingPage.summary !== summary;
      if (changed && !dryRun) {
        const { error } = await supabase.from('kb_pages').update({ ...pageRow, updated_at: new Date().toISOString() }).eq('id', pageId);
        if (error) throw new Error(`page update ${slug}: ${error.message}`);
      }
    } else if (!dryRun) {
      const { data: ins, error } = await supabase.from('kb_pages').insert({ firm_id: firm.id, slug, ...pageRow }).select('id').single();
      if (error) throw new Error(`page insert ${slug}: ${error.message}`);
      pageId = ins.id;
    }

    const codeRow = {
      firm_id: firm.id,
      id: codeId,
      title: meta.title,
      short_title: meta.shortTitle,
      instrument: meta.instrument,
      enacted_on: meta.enactedOn,
      effective_on: meta.effectiveOn,
      unit: meta.unit,
      edition: meta.edition,
      source_label: meta.sourceLabel,
      source_url: meta.sourceUrl,
      kb_page_id: pageId || null,
      position: meta.position,
      updated_at: new Date().toISOString(),
    };
    if (!dryRun) {
      const { error } = await supabase.from('legal_codes').upsert(codeRow, { onConflict: 'firm_id,id' });
      if (error) throw new Error(`code upsert ${codeId}: ${error.message}`);
    }

    const current = await fetchAllRows<{ id: number; number: string; former_number: string | null; position: number; path: string[]; heading: string | null; text: string; status: string; citation: string }>((from, to) =>
      supabase.from('code_provisions').select('id, number, former_number, position, path, heading, text, status, citation')
        .eq('code_id', codeId).order('id').range(from, to));
    const byNumber = new Map(current.map((r) => [r.number, r]));
    const currentVersions = await fetchAllRows<{ id: number; provision_id: number; seq: number; change: string; number: string | null; heading: string | null; text: string | null; effective_on: string | null; instrument: string | null; instrument_section: string | null; approved_on: string | null; instrument_url: string | null; note: string | null }>((from, to) =>
      supabase.from('code_provision_versions')
        .select('id, provision_id, seq, change, number, heading, text, effective_on, instrument, instrument_section, approved_on, instrument_url, note, code_provisions!inner(code_id)')
        .eq('code_provisions.code_id', codeId).order('id').range(from, to));
    const versionsOf = new Map<number, typeof currentVersions>();
    for (const v of currentVersions) versionsOf.set(v.provision_id, [...(versionsOf.get(v.provision_id) ?? []), v]);

    const versionKey = (v: CodeFileVersion) => JSON.stringify([v.seq, v.change, v.number, v.heading, v.text, v.effectiveOn, v.instrument, v.instrumentSection, v.approvedOn, v.instrumentUrl, v.note]);
    const storedKey = (v: (typeof currentVersions)[number]) => JSON.stringify([v.seq, v.change, v.number, v.heading, v.text, v.effective_on, v.instrument, v.instrument_section, v.approved_on, v.instrument_url, v.note]);

    for (const [position, p] of data.provisions.entries()) {
      const citation = provisionCitation(meta.shortTitle, meta.unit, p.number);
      const values = { former_number: p.formerNumber, position, path: p.path, heading: p.heading, text: p.text, status: p.status, citation };
      const cur = byNumber.get(p.number);
      let id = 0;
      let textChanged: boolean;
      if (cur) {
        id = cur.id;
        textChanged = cur.text !== p.text || cur.heading !== p.heading;
        const changed = textChanged || cur.former_number !== p.formerNumber || cur.position !== position || cur.status !== p.status
          || cur.citation !== citation || JSON.stringify(cur.path) !== JSON.stringify(p.path);
        if (changed && !dryRun) {
          const { error } = await supabase.from('code_provisions').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id);
          if (error) throw new Error(`update ${citation}: ${error.message}`);
        }
        if (changed) tallies.updated++; else tallies.unchanged++;
      } else {
        textChanged = true;
        if (!dryRun) {
          const { data: ins, error } = await supabase.from('code_provisions').insert({ firm_id: firm.id, code_id: codeId, number: p.number, ...values }).select('id').single();
          if (error) throw new Error(`insert ${citation}: ${error.message}`);
          id = ins.id;
        }
        tallies.inserted++;
      }

      if (id) {
        const stored = (versionsOf.get(id) ?? []).sort((a, b) => a.seq - b.seq).map(storedKey);
        const wanted = [...p.versions].sort((a, b) => a.seq - b.seq).map(versionKey);
        if (JSON.stringify(stored) !== JSON.stringify(wanted)) {
          tallies.versionsRewritten++;
          if (!dryRun) {
            const { error: delErr } = await supabase.from('code_provision_versions').delete().eq('provision_id', id);
            if (delErr) throw new Error(`versions clear ${citation}: ${delErr.message}`);
            const { error } = await supabase.from('code_provision_versions').insert(p.versions.map((v) => ({
              firm_id: firm.id,
              provision_id: id,
              seq: v.seq,
              change: v.change,
              number: v.number,
              heading: v.heading,
              text: v.text,
              effective_on: v.effectiveOn,
              instrument: v.instrument,
              instrument_section: v.instrumentSection,
              approved_on: v.approvedOn,
              instrument_url: v.instrumentUrl,
              note: v.note,
            })));
            if (error) throw new Error(`versions insert ${citation}: ${error.message}`);
          }
        }
      }

      if (textChanged && id && p.status === 'in_force') {
        toEmbed.push({
          id,
          text: `${citation}${p.heading ? `. ${p.heading}` : ''}${p.path.length ? ` — ${p.path.join(' › ')}` : ''}\n\n${p.text}`,
          metadata: { codeId, number: p.number, citation, heading: p.heading, kbPageId: pageId, codeTitle: meta.title },
        });
      }
    }

    const dropped = current.filter((r) => !data.provisions.some((p) => p.number === r.number));
    if (dropped.length) console.warn(`[import-codes] ${codeId}: in the database but not the file (left alone): ${dropped.map((r) => r.number).join(', ')}`);

    if (embed && !dryRun && toEmbed.length > 0) {
      console.log(`[import-codes] ${codeId}: embedding ${toEmbed.length} provision(s)…`);
      let i = 0;
      await Promise.all(Array.from({ length: EMBED_CONCURRENCY }, async () => {
        while (i < toEmbed.length) {
          const item = toEmbed[i++];
          await generateEmbeddingsForEntity('code_provision', String(item.id), null, item.text, item.metadata, firm.id);
          tallies.embedded++;
        }
      }));
    }
    console.log(`[import-codes] ${firm.slug} ${dryRun ? '(dry) ' : ''}${codeId}`, tallies);
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
