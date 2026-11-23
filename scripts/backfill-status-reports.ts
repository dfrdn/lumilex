/**
 * Backfill Status Report linkage + creation.
 *
 * Phase 1 (link): find existing status-report-ish deliverables that have no
 *   parent linkage and link them by normalized name match within the same matter.
 * Phase 2 (create): for attended hearings / filed deliverables since 2026-03-01
 *   that still have no linked SR, create new shells via the helper.
 *
 * Usage:
 *   npx tsx scripts/backfill-status-reports.ts                 # dry-run both phases
 *   npx tsx scripts/backfill-status-reports.ts --apply         # apply both phases
 *   npx tsx scripts/backfill-status-reports.ts --phase=1       # dry-run phase 1 only
 *   npx tsx scripts/backfill-status-reports.ts --phase=1 --apply
 *   npx tsx scripts/backfill-status-reports.ts --phase=2 --apply
 */

import { readFileSync } from 'fs';

// Load .env.local
const envContent = readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars (need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const SINCE = '2026-03-01';
const STATUS_REPORT_TYPE = 'Status Report';

// ── CLI args ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const phaseArg = args.find((a) => a.startsWith('--phase='));
const PHASE: 1 | 2 | 'both' = phaseArg
  ? (phaseArg.slice('--phase='.length) as '1' | '2') === '1'
    ? 1
    : 2
  : 'both';

// ── Helpers ──────────────────────────────────────────────────

/** Normalize name for fuzzy matching: lowercase, strip prefix, punctuation, collapse whitespace */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^status report\s*(—|-|:|re)?\s*/i, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Simple containment-based similarity score in [0, 1]. */
function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Check bi-directional containment — shorter string inside longer.
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (long.includes(short)) return short.length / long.length;
  // Fallback: ratio of shared tokens.
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}

const MATCH_THRESHOLD = 0.6;

function addDaysISO(date: Date, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ── Phase 1: link existing SRs by title match ───────────────

interface SrCandidate {
  notion_id: string;
  name: string;
  matter_id: string | null;
  type: string;
  status: string;
  created_time: string | null;
}

async function runPhase1() {
  console.log('\n━━━ Phase 1: Link existing Status Reports to parents ━━━');

  // Pool of existing SR-ish deliverables without linkage.
  // Exclude archived — don't resurrect a deliverable that was intentionally retired.
  const { data: orphanSRs, error: orphErr } = await supabase
    .from('deliverables')
    .select('notion_id, name, matter_id, type, status, created_time')
    .or(`type.eq.${STATUS_REPORT_TYPE},name.ilike.%status report%`)
    .is('related_hearing_id', null)
    .is('source_deliverable_id', null)
    .neq('status', 'Archived')
    .gte('created_time', SINCE);

  if (orphErr) {
    console.error('Phase 1: failed to load orphans:', orphErr.message);
    return;
  }

  console.log(`  • Found ${orphanSRs?.length ?? 0} unlinked SR-like deliverables since ${SINCE}`);

  if (!orphanSRs || orphanSRs.length === 0) {
    console.log('  • Nothing to link. Skipping.');
    return;
  }

  // Group by matter_id for fast per-matter lookup
  const byMatter = new Map<string, SrCandidate[]>();
  for (const cand of orphanSRs as SrCandidate[]) {
    if (!cand.matter_id) continue;
    const arr = byMatter.get(cand.matter_id) ?? [];
    arr.push(cand);
    byMatter.set(cand.matter_id, arr);
  }

  // ── 1a. Match attended hearings ─────────────────────────────
  const { data: hearings } = await supabase
    .from('hearings')
    .select('notion_id, name, matter_id, date')
    .eq('is_attended', true)
    .gte('date', SINCE);

  const hearingLinks: Array<{ srId: string; hearingId: string; score: number; hearingName: string; srName: string }> = [];
  const ambiguous: Array<{ parentName: string; srs: string[] }> = [];
  const usedSrIds = new Set<string>();

  for (const hearing of hearings ?? []) {
    if (!hearing.matter_id) continue;
    // Skip if this hearing already has a linked SR (idempotent)
    const { data: already } = await supabase
      .from('deliverables')
      .select('notion_id')
      .eq('related_hearing_id', hearing.notion_id)
      .eq('type', STATUS_REPORT_TYPE)
      .limit(1)
      .maybeSingle();
    if (already?.notion_id) continue;

    const candidates = byMatter.get(hearing.matter_id) ?? [];
    const scored = candidates
      .filter((c) => !usedSrIds.has(c.notion_id))
      .map((c) => ({ c, score: similarity(hearing.name, c.name) }))
      .filter((x) => x.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) continue;
    if (scored.length > 1 && scored[0].score - scored[1].score < 0.1) {
      ambiguous.push({
        parentName: `Hearing: ${hearing.name}`,
        srs: scored.slice(0, 3).map((s) => `"${s.c.name}" (${s.score.toFixed(2)})`),
      });
      continue;
    }

    const winner = scored[0];
    usedSrIds.add(winner.c.notion_id);
    hearingLinks.push({
      srId: winner.c.notion_id,
      hearingId: hearing.notion_id,
      score: winner.score,
      hearingName: hearing.name,
      srName: winner.c.name,
    });
  }

  // ── 1b. Match filed deliverables ────────────────────────────
  // Only External deliverables are actual filings (not Internal/For Client/etc.).
  // Also exclude anything named like a status report so duplicate SR pairs can't self-match.
  const { data: filedDelivs } = await supabase
    .from('deliverables')
    .select('notion_id, name, matter_id, date_done')
    .eq('status', 'Filed or Sent out')
    .eq('type', 'External')
    .not('name', 'ilike', 'status report%')
    .not('name', 'ilike', '% status report %')
    .gte('date_done', SINCE);

  const filingLinks: Array<{ srId: string; sourceId: string; score: number; sourceName: string; srName: string }> = [];

  for (const source of filedDelivs ?? []) {
    if (!source.matter_id) continue;
    const { data: already } = await supabase
      .from('deliverables')
      .select('notion_id')
      .eq('source_deliverable_id', source.notion_id)
      .eq('type', STATUS_REPORT_TYPE)
      .limit(1)
      .maybeSingle();
    if (already?.notion_id) continue;

    const candidates = byMatter.get(source.matter_id) ?? [];
    const scored = candidates
      .filter((c) => !usedSrIds.has(c.notion_id) && c.notion_id !== source.notion_id)
      .map((c) => ({ c, score: similarity(source.name, c.name) }))
      .filter((x) => x.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) continue;
    if (scored.length > 1 && scored[0].score - scored[1].score < 0.1) {
      ambiguous.push({
        parentName: `Filing: ${source.name}`,
        srs: scored.slice(0, 3).map((s) => `"${s.c.name}" (${s.score.toFixed(2)})`),
      });
      continue;
    }

    const winner = scored[0];
    usedSrIds.add(winner.c.notion_id);
    filingLinks.push({
      srId: winner.c.notion_id,
      sourceId: source.notion_id,
      score: winner.score,
      sourceName: source.name,
      srName: winner.c.name,
    });
  }

  // ── 1c. Report ──────────────────────────────────────────────
  console.log(`\n  Proposed hearing links (${hearingLinks.length}):`);
  for (const link of hearingLinks) {
    console.log(`    ${link.score.toFixed(2)}  "${link.srName}"  →  hearing "${link.hearingName}"`);
  }

  console.log(`\n  Proposed filing links (${filingLinks.length}):`);
  for (const link of filingLinks) {
    console.log(`    ${link.score.toFixed(2)}  "${link.srName}"  →  filing "${link.sourceName}"`);
  }

  if (ambiguous.length > 0) {
    console.log(`\n  ⚠ Ambiguous (${ambiguous.length}, skipped — manual review needed):`);
    for (const a of ambiguous) {
      console.log(`    ${a.parentName}`);
      for (const s of a.srs) console.log(`      - ${s}`);
    }
  }

  if (!APPLY) {
    console.log('\n  (dry run — no changes applied; re-run with --apply)');
    return;
  }

  // ── 1d. Apply ───────────────────────────────────────────────
  let applied = 0;
  for (const link of hearingLinks) {
    const { error } = await supabase
      .from('deliverables')
      .update({
        type: STATUS_REPORT_TYPE,
        related_hearing_id: link.hearingId,
      })
      .eq('notion_id', link.srId);
    if (error) {
      console.error(`    ✗ ${link.srId}: ${error.message}`);
    } else {
      applied += 1;
    }
  }
  for (const link of filingLinks) {
    const { error } = await supabase
      .from('deliverables')
      .update({
        type: STATUS_REPORT_TYPE,
        source_deliverable_id: link.sourceId,
      })
      .eq('notion_id', link.srId);
    if (error) {
      console.error(`    ✗ ${link.srId}: ${error.message}`);
    } else {
      applied += 1;
    }
  }

  console.log(`\n  ✓ Applied ${applied} links.`);
}

// ── Phase 2: create new SRs for orphaned parents ────────────

async function runPhase2() {
  console.log('\n━━━ Phase 2: Create new Status Report shells for orphaned parents ━━━');

  // Hearings missing SR
  const { data: hearings } = await supabase
    .from('hearings')
    .select('notion_id, name, matter_id, attendee_ids, date, firm_id')
    .eq('is_attended', true)
    .gte('date', SINCE);

  const orphanHearings: Array<NonNullable<typeof hearings>[number]> = [];
  for (const h of hearings ?? []) {
    const { data: existing } = await supabase
      .from('deliverables')
      .select('notion_id')
      .eq('related_hearing_id', h.notion_id)
      .eq('type', STATUS_REPORT_TYPE)
      .limit(1)
      .maybeSingle();
    if (!existing?.notion_id) orphanHearings.push(h);
  }

  // Filed deliverables missing SR. Only External = actual filings.
  // Also exclude anything named like an SR so duplicates don't spawn new shells.
  const { data: filedDelivs } = await supabase
    .from('deliverables')
    .select('notion_id, name, matter_id, drafter_ids, date_done, firm_id')
    .eq('status', 'Filed or Sent out')
    .eq('type', 'External')
    .not('name', 'ilike', 'status report%')
    .not('name', 'ilike', '% status report %')
    .gte('date_done', SINCE);

  const orphanFilings: Array<NonNullable<typeof filedDelivs>[number]> = [];
  for (const d of filedDelivs ?? []) {
    const { data: existing } = await supabase
      .from('deliverables')
      .select('notion_id')
      .eq('source_deliverable_id', d.notion_id)
      .eq('type', STATUS_REPORT_TYPE)
      .limit(1)
      .maybeSingle();
    if (!existing?.notion_id) orphanFilings.push(d);
  }

  console.log(`  • ${orphanHearings.length} orphan hearings`);
  console.log(`  • ${orphanFilings.length} orphan filings`);

  for (const h of orphanHearings) {
    const trig = h.date ? new Date(h.date) : new Date();
    console.log(
      `    hearing → "Status Report — ${h.name}" · due ${addDaysISO(trig, 2)} · drafters=${(h.attendee_ids ?? []).length}`,
    );
  }
  for (const d of orphanFilings) {
    const trig = d.date_done ? new Date(d.date_done) : new Date();
    console.log(
      `    filing → "Status Report — ${d.name}" · due ${addDaysISO(trig, 2)} · drafters=${(d.drafter_ids ?? []).length}`,
    );
  }

  if (!APPLY) {
    console.log('\n  (dry run — no changes applied; re-run with --apply)');
    return;
  }

  // Dynamically import the helper at apply time (needs Notion client from env)
  const { ensureStatusReportForHearing, ensureStatusReportForFiledDeliverable } = await import(
    '../lib/status-report-auto'
  );

  let created = 0;
  for (const h of orphanHearings) {
    const result = await ensureStatusReportForHearing(h.notion_id, {
      performedBy: 'backfill',
      triggerDate: h.date ? new Date(h.date) : undefined,
      firmId: h.firm_id,
    });
    if (result.created) {
      created += 1;
      console.log(`    ✓ ${h.name} → ${result.deliverableId}`);
    } else {
      console.log(`    ✗ ${h.name}: ${result.reason ?? 'unknown'}`);
    }
  }
  for (const d of orphanFilings) {
    const result = await ensureStatusReportForFiledDeliverable(d.notion_id, {
      performedBy: 'backfill',
      triggerDate: d.date_done ? new Date(d.date_done) : undefined,
      firmId: d.firm_id,
    });
    if (result.created) {
      created += 1;
      console.log(`    ✓ ${d.name} → ${result.deliverableId}`);
    } else {
      console.log(`    ✗ ${d.name}: ${result.reason ?? 'unknown'}`);
    }
  }

  console.log(`\n  ✓ Created ${created} new Status Reports.`);
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}  •  Phase: ${PHASE}`);
  if (PHASE === 1 || PHASE === 'both') await runPhase1();
  if (PHASE === 2 || PHASE === 'both') await runPhase2();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
