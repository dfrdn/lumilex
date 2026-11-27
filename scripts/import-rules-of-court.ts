/**
 * Load data/rules-of-court/sections.json (made by scripts/parse-rules-of-court.ts)
 * into one firm's Library: one kb_pages row per book (Civil Procedure,
 * Criminal Procedure, Evidence), which the Library renders whole from the
 * sections; one court_rule_sections row per section; and — when the firm keeps
 * vectors (`ai_search`) — one embedding per section for Search. Idempotent:
 * pages are matched by slug, sections by (source, rule, section); only
 * sections whose text changed are re-embedded. The one-page-per-rule pages of
 * the first import are removed. Run it for every firm that should carry the
 * Rules.
 *
 *   npx tsx scripts/import-rules-of-court.ts <firmIdOrSlug> [--source civil|criminal|evidence] [--dry-run] [--no-embed]
 *
 * The text is the Supreme Court's, the same for every firm; the rows are per
 * firm because each section points at its rule's page in that firm's Library.
 */
import './load-env';
import { readFileSync } from 'fs';

const DATA = 'data/rules-of-court/sections.json';
const EMBED_CONCURRENCY = 4;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function main() {
  const { getSupabase } = await import('@/lib/supabase');
  const { getServiceDbForFirm } = await import('@/lib/tenancy/service-db');
  const { isFeatureAvailable } = await import('@/lib/firm/features');
  const { generateEmbeddingsForEntity } = await import('@/lib/ai/embeddings');
  const { SOURCE_META } = await import('@/lib/rules/parse-rules-of-court');
  const { RULE_SOURCES, RULES_OF_COURT_KIND, rulesPartSlug, rulePageTitle, citationOf } = await import('@/lib/rules/model');
  type ParsedSection = import('@/lib/rules/parse-rules-of-court').ParsedSection;
  type RuleHeader = import('@/lib/rules/parse-rules-of-court').RuleHeader;

  const args = process.argv.slice(2);
  const firmRef = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--source');
  const only = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
  const dryRun = args.includes('--dry-run');

  if (!firmRef) {
    console.error('Usage: npx tsx scripts/import-rules-of-court.ts <firmIdOrSlug> [--source civil|criminal|evidence] [--dry-run] [--no-embed]');
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
    console.log(`[import-rules] ${firm.slug} does not have ai_search on — importing without embeddings (keyword search still covers the sections).`);
  }

  const data = JSON.parse(readFileSync(DATA, 'utf8')) as { rules: RuleHeader[]; sections: ParsedSection[] };
  const supabase = getServiceDbForFirm(firm.id);

  const tallies = { pagesInserted: 0, pagesUpdated: 0, sectionsInserted: 0, sectionsUpdated: 0, sectionsUnchanged: 0, embedded: 0, rulePagesRemoved: 0 };
  const toEmbed: { id: number; text: string; metadata: Record<string, unknown> }[] = [];

  for (const source of RULE_SOURCES.filter((s) => !only || s === only)) {
    const meta = SOURCE_META[source];
    const rules = data.rules.filter((r) => r.source === source && r.rule !== 144).sort((a, b) => a.rule - b.rule);
    const secs = data.sections.filter((s) => s.source === source).sort((a, b) => a.rule - b.rule || a.section - b.section);
    const slug = rulesPartSlug(source);
    const title = meta.label;
    const deletedRules = rules.filter((r) => !secs.some((s) => s.rule === r.rule));

    // A preface above the sections: the publication, and what the amendments took out.
    const parts: string[] = [
      `<p class="lead">${esc(meta.issuance)}, effective ${esc(fmtDate(meta.effective))}. Rules ${rules[0]?.rule}–${rules.at(-1)?.rule}, ${secs.length} sections.</p>`,
    ];
    for (const r of deletedRules) {
      const note = source === 'civil' && r.rule === 16
        ? ' Its grounds are now raised as affirmative defenses in the answer under Rule 8, Section 12, and the remaining motions to dismiss are governed by Rule 15, Section 12.'
        : '';
      parts.push(`<p>${esc(rulePageTitle(r.rule, r.title))} was deleted by the amendments.${esc(note)}</p>`);
    }
    const content = parts.join('\n');
    const summary = `${meta.short} · Rules ${rules[0]?.rule}–${rules.at(-1)?.rule} · ${secs.length} sections · ${meta.issuance}`;

    let pageId: number;
    const { data: existing } = await supabase.from('kb_pages').select('id, title, content_md, summary').eq('slug', slug).maybeSingle();
    const row = {
      kind: RULES_OF_COURT_KIND,
      title,
      content_md: content,
      content_format: 'html',
      summary,
      jurisdiction: 'Philippines',
      status: 'published',
      generated_by: 'manual',
      author_name: 'Supreme Court of the Philippines',
      visible_to_roles: null,
    };
    if (existing) {
      pageId = existing.id;
      const changed = existing.title !== title || existing.content_md !== content || existing.summary !== summary;
      if (changed && !dryRun) {
        const { error } = await supabase.from('kb_pages').update({ ...row, updated_at: new Date().toISOString() }).eq('id', pageId);
        if (error) throw new Error(`page update ${slug}: ${error.message}`);
      }
      if (changed) tallies.pagesUpdated++;
    } else {
      if (dryRun) { pageId = 0; } else {
        const { data: inserted, error } = await supabase.from('kb_pages').insert({ slug, ...row }).select('id').single();
        if (error) throw new Error(`page insert ${slug}: ${error.message}`);
        pageId = inserted.id;
      }
      tallies.pagesInserted++;
    }

    for (const s of secs) {
      const citation = citationOf(s.rule, s.section);
      const { data: cur } = await supabase
        .from('court_rule_sections')
        .select('id, text, title, heading, part, rule_title, kb_page_id')
        .eq('source', s.source).eq('rule', s.rule).eq('section', s.section)
        .maybeSingle();
      const values = { part: s.part, rule_title: s.ruleTitle, heading: s.heading, title: s.title, text: s.text, citation, kb_page_id: pageId || null };
      let id: number;
      let textChanged: boolean;
      if (cur) {
        id = cur.id;
        textChanged = cur.text !== s.text || cur.title !== s.title;
        const changed = textChanged || cur.heading !== s.heading || cur.part !== s.part || cur.rule_title !== s.ruleTitle || cur.kb_page_id !== (pageId || null);
        if (changed && !dryRun) {
          const { error } = await supabase.from('court_rule_sections').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id);
          if (error) throw new Error(`section update ${citation}: ${error.message}`);
        }
        if (changed) tallies.sectionsUpdated++; else tallies.sectionsUnchanged++;
      } else {
        textChanged = true;
        if (dryRun) { id = 0; } else {
          const { data: ins, error } = await supabase.from('court_rule_sections').insert({ source: s.source, rule: s.rule, section: s.section, ...values }).select('id').single();
          if (error) throw new Error(`section insert ${citation}: ${error.message}`);
          id = ins.id;
        }
        tallies.sectionsInserted++;
      }
      if (textChanged && id) {
        toEmbed.push({
          id,
          text: `${citation}. ${s.title} (${meta.short})${s.heading ? ` — ${s.heading}` : ''}\n\n${s.text}`,
          metadata: { source: s.source, rule: s.rule, section: s.section, citation, title: s.title, ruleTitle: s.ruleTitle, kbPageId: pageId, sourceLabel: meta.short },
        });
      }
    }

    // The first import made a page per rule; the book's page replaces them.
    const { data: rulePages } = await supabase.from('kb_pages').select('id, slug').eq('kind', RULES_OF_COURT_KIND).like('slug', `${slug}-rule-%`);
    if (rulePages?.length) {
      if (!dryRun) {
        const { error } = await supabase.from('kb_pages').delete().in('id', rulePages.map((p) => p.id));
        if (error) throw new Error(`remove rule pages ${slug}: ${error.message}`);
      }
      tallies.rulePagesRemoved += rulePages.length;
    }
    console.log(`${dryRun ? '(dry) ' : ''}${title}: ${secs.length} sections`);
  }

  if (embed && !dryRun && toEmbed.length > 0) {
    console.log(`[import-rules] embedding ${toEmbed.length} section(s)…`);
    let i = 0;
    await Promise.all(Array.from({ length: EMBED_CONCURRENCY }, async () => {
      while (i < toEmbed.length) {
        const item = toEmbed[i++];
        await generateEmbeddingsForEntity('court_rule', String(item.id), null, item.text, item.metadata, firm.id);
        tallies.embedded++;
        if (tallies.embedded % 100 === 0) console.log(`  embedded ${tallies.embedded}/${toEmbed.length}`);
      }
    }));
  }
  console.log(`[import-rules] ${firm.slug} done`, tallies);
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
