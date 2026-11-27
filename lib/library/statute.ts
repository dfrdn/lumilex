import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase-paginate';
import {
  LEGAL_CODE_KIND, latestChange, provisionAnchor, provisionLabel,
  type CodeUnit, type ProvisionChange, type ProvisionStatus,
} from '@/lib/codes/model';
import { SOURCE_META, type RuleSource } from '@/lib/rules/parse-rules-of-court';
import { RULE_SOURCES, RULES_OF_COURT_KIND, ruleAnchor, rulePageTitle, rulesPartSlug, ruleSectionAnchor, titleCase } from '@/lib/rules/model';

/**
 * A code or a book of the Rules of Court, shaped for reading as one page:
 * its provisions in order, each with the divisions above it, and for a code
 * the mark of its last change. The Library renders this instead of the
 * page's stored HTML.
 */
export interface StatuteDoc {
  kind: 'code' | 'rules';
  /** The code id, or the Rules book. */
  key: string;
  title: string;
  /** "Presidential Decree No. 442 · DOLE Edition 2022 …" */
  descriptor: string;
  effectiveOn: string | null;
  sourceLabel: string;
  sourceUrl: string;
  unit: CodeUnit;
  provisions: StatuteProvision[];
  /** Provisions a reviewer has checked against the source. Codes only. */
  reviewedCount: number;
}

export interface StatuteProvision {
  id: number;
  anchor: string;
  /** "Art. 237. [231]", "Sec. 3." */
  label: string;
  heading: string | null;
  text: string;
  /** Divisions above, outermost first. Each is one line of the table of contents. */
  path: { anchor: string; label: string }[];
  status: ProvisionStatus;
  citation: string;
  /** For a code: the last change that reached the provision. */
  change: ProvisionChange | null;
  reviewed: boolean;
}

function divisionAnchor(prefix: string, labels: string[]): string {
  return `${prefix}-${labels.map((l) => l.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)).join('--')}`;
}

async function loadCode(supabase: SupabaseClient, pageId: number): Promise<StatuteDoc | null> {
  const { data: code } = await supabase.from('legal_codes').select('*').eq('kb_page_id', pageId).maybeSingle();
  if (!code) return null;

  const [rows, versions, reviews] = await Promise.all([
    fetchAllRows<{ id: number; number: string; former_number: string | null; path: string[]; heading: string | null; text: string; status: ProvisionStatus; citation: string }>((from, to) =>
      supabase.from('code_provisions')
        .select('id, number, former_number, path, heading, text, status, citation')
        .eq('code_id', code.id).order('position').order('id').range(from, to)),
    fetchAllRows<{ id: number; provision_id: number; seq: number; change: ProvisionChange }>((from, to) =>
      supabase.from('code_provision_versions')
        .select('id, provision_id, seq, change, code_provisions!inner(code_id)')
        .eq('code_provisions.code_id', code.id).order('id').range(from, to)),
    fetchAllRows<{ id: number; provision_id: number }>((from, to) =>
      supabase.from('code_provision_reviews')
        .select('id, provision_id, code_provisions!inner(code_id)')
        .eq('code_provisions.code_id', code.id).order('id').range(from, to)),
  ]);

  const byProvision = new Map<number, { seq: number; change: ProvisionChange }[]>();
  for (const v of versions) {
    const list = byProvision.get(v.provision_id) ?? [];
    list.push(v);
    byProvision.set(v.provision_id, list);
  }
  const reviewed = new Set(reviews.map((r) => r.provision_id));
  const unit = code.unit as CodeUnit;

  return {
    kind: 'code',
    key: code.id,
    title: code.title,
    descriptor: [code.instrument, code.edition].filter(Boolean).join(' · '),
    effectiveOn: code.effective_on,
    sourceLabel: code.source_label ?? code.instrument,
    sourceUrl: code.source_url ?? '',
    unit,
    reviewedCount: reviewed.size,
    provisions: rows.map((r) => ({
      id: r.id,
      anchor: provisionAnchor(unit, r.number),
      label: provisionLabel(unit, r.number, r.former_number),
      heading: r.heading,
      text: r.text,
      path: r.path.map((label, i) => ({ label, anchor: divisionAnchor('d', r.path.slice(0, i + 1)) })),
      status: r.status,
      citation: r.citation,
      change: latestChange(byProvision.get(r.id) ?? []),
      reviewed: reviewed.has(r.id),
    })),
  };
}

async function loadRulesBook(supabase: SupabaseClient, slug: string): Promise<StatuteDoc | null> {
  const source = RULE_SOURCES.find((s) => rulesPartSlug(s) === slug);
  if (!source) return null;
  const meta = SOURCE_META[source as RuleSource];
  const rows = await fetchAllRows<{ id: number; part: string | null; rule: number; rule_title: string; heading: string | null; section: number; title: string; text: string; citation: string }>((from, to) =>
    supabase.from('court_rule_sections')
      .select('id, part, rule, rule_title, heading, section, title, text, citation')
      .eq('source', source).order('rule').order('section').order('id').range(from, to));

  return {
    kind: 'rules',
    key: source,
    title: meta.label,
    descriptor: meta.issuance,
    effectiveOn: meta.effective,
    sourceLabel: 'Official text',
    sourceUrl: meta.url,
    unit: 'section',
    reviewedCount: 0,
    provisions: rows.map((r) => {
      const path: { anchor: string; label: string }[] = [];
      if (r.part) path.push({ label: titleCase(r.part), anchor: divisionAnchor('part', [r.part]) });
      path.push({ label: rulePageTitle(r.rule, r.rule_title), anchor: ruleAnchor(r.rule) });
      if (r.heading) path.push({ label: r.heading, anchor: `${ruleAnchor(r.rule)}-${divisionAnchor('h', [r.heading])}` });
      return {
        id: r.id,
        anchor: ruleSectionAnchor(r.rule, r.section),
        label: `Sec. ${r.section}.`,
        heading: r.title,
        text: r.text,
        path,
        status: 'in_force' as const,
        citation: r.citation,
        change: null,
        reviewed: false,
      };
    }),
  };
}

/** The readable form of a code or Rules page, or null for any other page. */
export async function loadStatute(supabase: SupabaseClient, page: { id: number; kind: string; slug: string }): Promise<StatuteDoc | null> {
  if (page.kind === LEGAL_CODE_KIND) return loadCode(supabase, page.id);
  if (page.kind === RULES_OF_COURT_KIND) return loadRulesBook(supabase, page.slug);
  return null;
}
