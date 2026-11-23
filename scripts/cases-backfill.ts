/**
 * Plan one firm's cases backfill from the case fields on its matters
 * (lib/cases/backfill-plan.ts). Reads only. The plan names clients and
 * parties, so it is written outside the repo, never committed.
 *
 *   npx tsx scripts/cases-backfill.ts <firmIdOrSlug> --out /path/outside/repo [--config decisions.json]
 *
 * Writes plan.json (the cases and proceedings to create), review.md (what
 * needs a person: merges, guessed relations, multi-docket fields, cases
 * without a forum, related cases, and litigation with no case data) and
 * backfill.sql (the plan as one transaction, every row stamped with the firm
 * — lib/cases/backfill-sql.ts). Nothing here writes to a database; run
 * backfill.sql on the local stack first.
 *
 * The decisions a person makes after reading review.md go in the optional
 * --config file, also kept outside the repo, keyed by matter code:
 *   { "exclude": { "<code>": "why it is not a case" },
 *     "evaluation": ["<code>"],                 // covers the evaluation phase
 *     "merge": [["<code>", "<code>", ...]] }    // one dispute under several dockets
 */
import './load-env';
import * as fs from 'fs';
import * as path from 'path';
import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { fetchAllRows } from '../lib/supabase-paginate';
import { buildCasePlan, type PlannedCase, type SourceMatter } from '../lib/cases/backfill-plan';
import { backfillSql } from '../lib/cases/backfill-sql';

interface Decisions {
  exclude?: Record<string, string>;
  evaluation?: string[];
  merge?: string[][];
}

async function resolveFirm(requested: string | undefined): Promise<{ id: string; slug: string }> {
  if (!requested) {
    console.error('Usage: npx tsx scripts/cases-backfill.ts <firmIdOrSlug> --out <dir> [--config decisions.json]');
    process.exit(1);
  }
  const { data } = await getSupabase().from('firms').select('id, slug').order('slug');
  const firms = (data ?? []) as { id: string; slug: string }[];
  const hit = firms.find((f) => f.id === requested || f.slug === requested);
  if (!hit) {
    console.error(`No firm matching "${requested}". Known firms: ${firms.map((f) => f.slug).join(', ') || '(none)'}`);
    process.exit(1);
  }
  return hit;
}

interface MatterRow {
  notion_id: string;
  matter_code: string;
  name: string;
  type: string;
  status: string;
  client_id: string | null;
  client_name: string;
  case_number: string;
  court: string;
  case_title: string;
  related_matter_ids: string[] | null;
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : null;
  };
  const out = arg('--out');
  if (!out) throw new Error('Pass --out <directory outside the repo>');
  if (path.resolve(out).startsWith(path.resolve(__dirname, '..'))) throw new Error('--out must be outside the repo: the plan holds client facts');
  const configPath = arg('--config');
  const decisions: Decisions = configPath ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const flagValues = new Set([out, configPath]);
  const firm = await resolveFirm(process.argv.slice(2).find((a) => !a.startsWith('--') && !flagValues.has(a)));

  const supabase = getServiceDbForFirm(firm.id);
  const rows = await fetchAllRows<MatterRow>((from, to) =>
    supabase
      .from('matters')
      .select('notion_id, matter_code, name, type, status, client_id, client_name, case_number, court, case_title, related_matter_ids')
      .order('notion_id')
      .range(from, to),
  );
  const hearings = await fetchAllRows<{ notion_id: string; matter_id: string | null; name: string | null; date: string | null; status: string | null }>((from, to) =>
    supabase.from('hearings').select('notion_id, matter_id, name, date, status').order('notion_id').range(from, to),
  );

  const hearingsByMatter = new Map<string, number>();
  const upcomingHearings = new Set<string>();
  const hearingNames = new Map<string, { name: string; date: string | null }[]>();
  const now = new Date();
  for (const h of hearings) {
    if (!h.matter_id) continue;
    if ((h.status ?? '').toLowerCase() !== 'cancelled') {
      hearingNames.set(h.matter_id, [...(hearingNames.get(h.matter_id) ?? []), { name: h.name ?? '', date: h.date }]);
    }
    hearingsByMatter.set(h.matter_id, (hearingsByMatter.get(h.matter_id) ?? 0) + 1);
    if (h.date && new Date(h.date) >= now && (h.status ?? '').toLowerCase() !== 'cancelled') upcomingHearings.add(h.matter_id);
  }

  const matters: SourceMatter[] = rows.map((r) => ({
    id: r.notion_id,
    code: r.matter_code,
    name: r.name,
    type: r.type,
    status: r.status,
    clientId: r.client_id,
    clientName: r.client_name,
    caseNumber: r.case_number ?? '',
    court: r.court ?? '',
    caseTitle: r.case_title ?? '',
    relatedMatterIds: r.related_matter_ids ?? [],
  }));
  const byId = new Map(matters.map((m) => [m.id, m]));
  const plan = buildCasePlan(matters, hearingsByMatter, {
    exclude: decisions.exclude ?? {},
    evaluation: decisions.evaluation ?? [],
    merge: decisions.merge ?? [],
    upcomingHearings,
    hearingNames,
  });

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(out, 'review.md'), review(plan, byId, hearings.length));
  fs.writeFileSync(path.join(out, 'backfill.sql'), backfillSql(plan, firm.id));
  console.log(`${firm.slug}: ${plan.cases.length} cases planned; review at ${path.join(out, 'review.md')}`);
}

function review(plan: ReturnType<typeof buildCasePlan>, byId: Map<string, SourceMatter>, hearingTotal: number): string {
  const label = (id: string) => {
    const m = byId.get(id)!;
    return `${m.code} ${m.name} (${m.status})`;
  };
  const caseLine = (c: PlannedCase) => {
    const procs = c.proceedings
      .map((p) => `  - ${p.relation === 'original' ? '' : `${p.relation} → `}**${p.office || p.forum.type}** · ${p.track}: ${p.stage}${p.docket ? ` · ${p.docket}` : ''}${p.resolved ? ' · resolved' : ''}${p.hearingCount ? ` · ${p.hearingCount} hearings` : ''}\n${p.matterIds.map((id) => `    - ${label(id)}`).join('\n')}`)
      .join('\n');
    const evalLines = c.evaluationMatterIds.map((id) => `  - evaluation\n    - ${label(id)}`).join('\n');
    const flags = c.flags.map((f) => `  - ⚠️ ${f}`).join('\n');
    return [`- **${c.title}**${c.nature ? ` · ${c.nature}` : ''} — ${c.status}`, evalLines, procs, flags].filter(Boolean).join('\n');
  };

  const procs = plan.cases.flatMap((c) => c.proceedings);
  const hearingsPlaced = procs.reduce((n, p) => n + p.hearingCount, 0);
  const merged = plan.cases.filter((c) => c.matterIds.length > 1);
  const flagged = plan.cases.filter((c) => c.flags.length && c.matterIds.length === 1);
  const byStatus = (s: PlannedCase['status']) => plan.cases.filter((c) => c.status === s).length;
  const byForum = new Map<string, number>();
  for (const p of procs) {
    const k = p.forum.level ?? p.forum.type;
    byForum.set(k, (byForum.get(k) ?? 0) + 1);
  }

  return `# Cases backfill — dry run

Generated ${new Date().toISOString()}. Nothing was written.

## Summary
- **${plan.cases.length} cases** (${byStatus('active')} active, ${byStatus('closed')} closed, ${byStatus('evaluation')} in evaluation) from ${plan.cases.reduce((n, c) => n + c.matterIds.length, 0)} matters
- **${procs.length} proceedings**: ${[...byForum].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}
- **${hearingsPlaced} of ${hearingTotal} hearings** land on a proceeding (the rest sit on matters with no case)
- ${merged.length} cases merge several matters · ${plan.likelySameDispute.length} pairs that may be one dispute · ${plan.related.length - plan.likelySameDispute.length} other related-case links · ${plan.excluded.length} excluded · ${plan.withoutCase.length} litigation/labor matters with no case data

## Cases made from several matters
${merged.map(caseLine).join('\n')}

## Single-matter cases that need a look
${flagged.map(caseLine).join('\n') || '_None._'}

## Probably one dispute under a new docket — merge?
Related cases with the same respondents where one sits earlier on the path (a complaint, then the case filed in court on it). Each pair would become one case with two proceedings.

${plan.likelySameDispute.map(([a, b]) => {
    const ca = plan.cases.find((c) => c.key === a)!;
    const cb = plan.cases.find((c) => c.key === b)!;
    const where = (c: PlannedCase) => c.proceedings.map((p) => p.office || p.forum.type).join(' → ') || 'no forum';
    return `- [ ] **${ca.title}** (${where(ca)}) + **${cb.title}** (${where(cb)})`;
  }).join('\n') || '_None._'}

## Other related cases (linked, not merged)
${plan.related.filter((r) => !plan.likelySameDispute.includes(r)).map(([a, b]) => `- ${plan.cases.find((c) => c.key === a)!.title} ↔ ${plan.cases.find((c) => c.key === b)!.title}`).join('\n') || '_None._'}

## Excluded
${plan.excluded.map((e) => `- ${e.matter.code} ${e.matter.name} — ${e.reason}`).join('\n')}

## Litigation and labor matters with no case data (no case created)
${plan.withoutCase.map((m) => `- ${m.code} ${m.name} (${m.status})`).join('\n')}
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
