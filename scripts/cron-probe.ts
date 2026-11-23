import './load-env';
import './probe-websocket';
import { probeFetch } from './probe-fetch';
import { mintId } from '../lib/ids';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { forEachActiveFirm } from '../lib/tenancy/fan-out';

/**
 * Cron fan-out probe. `scripts/rls-probe.ts` proves a query cannot cross a
 * firm boundary and `scripts/storage-probe.ts` proves an object cannot; this
 * one proves the crons actually visit every firm, and that one firm's bad day
 * is not every firm's.
 *
 * Three claims, each checked a different way:
 *
 *   1. EVERY CRON FANS OUT — static: a handler that authenticates with
 *      CRON_SECRET must route through `forEachActiveFirm` /
 *      `forEachFirmWithFeature`, or be listed in ENTITY_SCOPED with the reason
 *      it doesn't (those take one entity id and resolve the firm from the row).
 *
 *   2. A SKIPPED FIRM IS VISIBLE — live: a firm without the feature comes back
 *      IN the results with a `skipped` reason. An absent firm and a firm that
 *      did nothing look identical from the outside, and that is what hid two
 *      silently-broken crons before.
 *
 *   3. ONE FIRM'S FAILURE IS ONE FIRM'S — live, with a broken fixture: one
 *      probe firm gets a `files` row whose `file_urls` holds a JSON *string*
 *      of invalid JSON, which makes `/api/file-analysis/backfill` throw for
 *      that firm and only that firm. A second probe firm with no files must
 *      still come back `ok: true`, actually run rather than skipped, in the
 *      same response. Nothing else proves per-firm isolation end to end; the
 *      unit test for `forEachActiveFirm` proves the helper, not the handlers.
 *
 *      That cron fans out over `ai_analysis`, so both isolation firms are
 *      entitled to it and registered — otherwise they are skipped before the
 *      fixture is read. Neither can reach a model: the broken firm throws in
 *      the parse, before any analysis starts, and the clean firm has nothing
 *      to analyse. The skip-visibility firm stays entitled to nothing.
 *
 *      This replaces the original vehicle, which poisoned
 *      `attendance.date_label` — dropped with the clock-in feature. Finding a
 *      new one took a catalog sweep: `date_label` was the last TEXT column
 *      holding a date among the tables the remaining crons read, and the one
 *      cron still doing a per-row write logs its insert errors and continues.
 *      What works instead is a column that is jsonb yet still reaches a
 *      `JSON.parse`: `files.file_urls` is jsonb, so Postgres rejects malformed
 *      JSON — but a jsonb SCALAR STRING is perfectly valid, comes back from
 *      supabase-js as a JS string, and so takes the handler's
 *      `typeof file_urls === 'string'` branch straight into JSON.parse. That
 *      branch exists for legacy rows; this is the shape it mishandles.
 *
 * Needs the dev server running (`npm run dev`) and CRON_SECRET in .env.local.
 *
 * Usage:
 *   npx tsx scripts/cron-probe.ts                  # static + live
 *   npx tsx scripts/cron-probe.ts --static-only    # no server, no fixtures
 *   PROBE_BASE_URL=http://127.0.0.1:3000 npx tsx scripts/cron-probe.ts
 *
 * Exits 1 on any violation.
 */

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.PROBE_BASE_URL ?? 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET!;
const PROBE_SLUG = 'cron-probe';
const BROKEN_SLUG = 'cron-probe-broken';
const CLEAN_SLUG = 'cron-probe-clean';
const ENTITLED_SLUG = 'cron-probe-entitled';
const PROBE_SLUGS = [PROBE_SLUG, BROKEN_SLUG, CLEAN_SLUG, ENTITLED_SLUG];

/**
 * CRON_SECRET handlers that legitimately do not fan out: each takes one entity
 * id and resolves that row's own firm (the firm-resolution lookup pattern), so
 * there is nothing to iterate. A NEW file here needs the same justification.
 */
const ENTITY_SCOPED: Record<string, string> = {
  'app/api/deliverable-analyze/route.ts':
    'DB webhook for one deliverable; firm comes from the row (or a payload firmId that must match)',
  'app/api/matter-summary/route.ts':
    'DB trigger for one matter; firm comes from the row (or a payload firmId that must match)',
  'app/api/admin/sharepoint-sync/route.ts':
    'webhook for one file/deliverable; firm comes from the row (or a payload firmId that must match)',
  'app/api/file-analysis/auto/route.ts':
    'DB webhook for one file; firm comes from the row (or a payload firmId that must match). It reads CRON_SECRET because the webhook already sends it — the route just never checked, which left it open',
};

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '✗ FAIL'}  ${name}${pass ? '' : `  — ${detail}`}`);
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name === 'route.ts') yield full;
  }
}

// ── 1. static: every CRON_SECRET handler fans out ──────────────────

function staticFanOutCheck(): void {
  const missing: string[] = [];
  let fanned = 0;
  const exempt: string[] = [];

  for (const abs of walk(path.join(ROOT, 'app', 'api'))) {
    const rel = path.relative(ROOT, abs);
    const source = fs.readFileSync(abs, 'utf-8');
    if (!source.includes('CRON_SECRET')) continue;
    if (/forEach(ActiveFirm|FirmWithFeature)/.test(source)) { fanned++; continue; }
    if (rel in ENTITY_SCOPED) { exempt.push(rel); continue; }
    missing.push(rel);
  }

  console.log(`   ${fanned} cron handlers fan out, ${exempt.length} entity-scoped by design`);
  for (const rel of exempt) console.log(`   · ${rel} — ${ENTITY_SCOPED[rel]}`);

  record('every CRON_SECRET handler fans out per firm', missing.length === 0,
    `no fan-out and no recorded reason:\n${missing.map((m) => `      ${m}`).join('\n')}`);

  const stale = Object.keys(ENTITY_SCOPED).filter((k) => !fs.existsSync(path.join(ROOT, k)));
  if (stale.length > 0) console.warn(`Note: prune ENTITY_SCOPED entries that no longer exist: ${stale.join(', ')}`);
}

// ── 2. in-process: the fan-out helper isolates a throwing firm ──────

async function fanOutIsolationCheck(): Promise<void> {
  const visited: string[] = [];
  const results = await forEachActiveFirm(async ({ firm }) => {
    visited.push(firm.slug);
    if (firm.slug === PROBE_SLUG) throw new Error('probe: deliberate per-firm failure');
    return { ok: true };
  });

  const probe = results.find((r) => r.slug === PROBE_SLUG);
  const others = results.filter((r) => r.slug !== PROBE_SLUG);

  record('fan-out records the throwing firm as failed', probe?.ok === false && !!probe.error,
    `probe firm result: ${JSON.stringify(probe)}`);
  record('fan-out still ran every other firm', others.length > 0 && others.every((r) => r.ok),
    `other firms: ${JSON.stringify(others.map((r) => ({ slug: r.slug, ok: r.ok })))}`);
  record('fan-out visited the throwing firm and the rest', visited.length === results.length,
    `visited ${visited.join(', ')}`);
}

// ── 3. live: skip visibility and per-firm error isolation ──────────

const service = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function cronFetch(pathname: string, init?: RequestInit) {
  const res = await probeFetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, json, text: text.slice(0, 400) };
}

type FirmRow = { firmId: string; slug: string; ok: boolean; error?: string; skipped?: string };

function firmRows(json: Record<string, unknown> | null): FirmRow[] {
  const rows = (json?.firms ?? json?.results) as FirmRow[] | undefined;
  return Array.isArray(rows) ? rows : [];
}

type ProbeFirms = { probe: string; broken: string; clean: string; entitled: string };

async function insertProbeFirm(slug: string, name: string, features: Record<string, boolean>): Promise<string> {
  const { data, error } = await service
    .from('firms')
    .insert({ slug, name, short_name: 'CRON', status: 'active', settings: { features } })
    .select('id')
    .single();
  if (error) throw new Error(`probe firm ${slug} insert failed: ${error.message}`);
  return data.id as string;
}

/**
 * Entitled and registered for `ai_analysis`, so the backfill cron's
 * feature-gated fan-out runs the firm instead of skipping it. The third level,
 * credentials, is the platform's Anthropic key — the dev server's, not ours.
 */
async function insertAiAnalysisFirm(slug: string, name: string): Promise<string> {
  const id = await insertProbeFirm(slug, name, { ai_analysis: true });
  const { error } = await service
    .from('firm_integrations')
    .insert({ firm_id: id, feature: 'ai_analysis', enabled: true });
  if (error) throw new Error(`firm_integrations insert for ${slug} failed: ${error.message}`);
  return id;
}

/**
 * Entitled to SharePoint and registered, with no credentials sealed: the
 * feature-gated fan-out skips it, for a different reason than a firm that was
 * never entitled. Its own fixture rather than the development firm, which a
 * bootstrapped instance does not have.
 */
async function insertEntitledFirm(slug: string, name: string): Promise<string> {
  const id = await insertProbeFirm(slug, name, { sharepoint: true });
  const { error } = await service
    .from('firm_integrations')
    .insert({ firm_id: id, feature: 'sharepoint', enabled: true });
  if (error) throw new Error(`firm_integrations insert for ${slug} failed: ${error.message}`);
  return id;
}

async function provisionProbeFirms(): Promise<ProbeFirms> {
  return {
    // Active so the fan-out visits it; entitled to nothing so the
    // feature-gated fan-out has a reason to skip it.
    probe: await insertProbeFirm(PROBE_SLUG, 'Cron Probe Firm', {}),
    broken: await insertAiAnalysisFirm(BROKEN_SLUG, 'Cron Probe Broken Firm'),
    clean: await insertAiAnalysisFirm(CLEAN_SLUG, 'Cron Probe Clean Firm'),
    entitled: await insertEntitledFirm(ENTITLED_SLUG, 'Cron Probe Entitled Firm'),
  };
}

/**
 * The broken fixture. `files.file_urls` is jsonb, so it cannot hold malformed
 * JSON — but it CAN hold a jsonb scalar string, and supabase-js hands that back
 * as a JS string. `/api/file-analysis/backfill` then takes its
 * `typeof file_urls === 'string'` legacy branch and calls JSON.parse on
 * content that is not JSON, which throws. One row, one firm, no other firm's
 * data touched, and no AI work: the parse throws before any analysis starts.
 *
 * The handler's own `.neq('file_urls', '[]')` filter still selects the row.
 */
async function poisonFileUrls(firmId: string): Promise<void> {
  const id = mintId('file');
  const { error } = await service.from('files').insert({
    notion_id: id,
    name: 'Cron probe — malformed file_urls',
    file_urls: '{not-json',
    firm_id: firmId,
  });
  if (error) throw new Error(`file_urls fixture insert failed: ${error.message}`);
}

async function liveProbe(firms: ProbeFirms): Promise<void> {
  const probeFirmId = firms.probe;
  console.log('── auth ──');
  {
    const res = await probeFetch(`${BASE_URL}/api/matters/auto-archive`);
    record('cron endpoint refuses a call without CRON_SECRET', res.status === 401,
      `expected 401, got ${res.status}`);
  }

  console.log('── skip visibility (feature-gated fan-out) ──');
  {
    // A very large offset makes the per-firm work a no-op for every firm that
    // DOES have the feature, so the probe observes routing without doing work.
    const { status, json, text } = await cronFetch('/api/admin/sharepoint-backfill', {
      method: 'POST',
      body: JSON.stringify({ offset: 5_000_000, kind: 'files' }),
    });
    const rows = firmRows(json);
    const probe = rows.find((r) => r.firmId === probeFirmId);
    const entitled = rows.find((r) => r.firmId === firms.entitled);

    const { count: activeFirms } = await service
      .from('firms').select('*', { count: 'exact', head: true }).eq('status', 'active');

    record('feature-gated cron returns a row for every active firm',
      status === 200 && rows.length === (activeFirms ?? -1),
      `HTTP ${status}, ${rows.length} firm rows vs ${activeFirms} active firms — ${text}`);
    record('firm without the entitlement is present and marked skipped',
      !!probe && probe.skipped === 'not_entitled',
      probe ? `probe firm row: ${JSON.stringify(probe)}` : 'probe firm is ABSENT from the results');
    // The entitled firm has no credentials, so it is skipped too — for a
    // DIFFERENT reason. That distinction is the point: "did nothing" and "was
    // never asked" have to be tellable apart, and so do the two ways a firm can
    // be skipped.
    record('an entitled firm reports its own distinct outcome',
      !!entitled && (entitled.skipped === undefined ? entitled.ok : entitled.skipped !== probe?.skipped),
      entitled ? `entitled firm row: ${JSON.stringify(entitled)}` : 'entitled firm is absent from the results');
  }

  console.log('── per-firm error isolation (broken fixture on one firm) ──');
  {
    await poisonFileUrls(firms.broken);
    // offset 0 so the broken firm's one poisoned row is in range. Each firm
    // entitled to ai_analysis reads its OWN first batch, so this costs
    // whatever that firm has to do — nothing for the two probe firms. If
    // another firm on this project is ever entitled and holds a real file
    // corpus, revisit: the check would start doing that firm's real backfill
    // work, model calls included, on every run.
    const { status, json, text } = await cronFetch('/api/file-analysis/backfill', {
      method: 'POST',
      body: JSON.stringify({ offset: 0 }),
    });
    const rows = firmRows(json);
    const probe = rows.find((r) => r.firmId === firms.broken);
    const clean = rows.find((r) => r.firmId === firms.clean);

    record('a firm failing does not fail the whole cron', status === 200,
      `expected 200, got ${status} — ${text}`);
    record('the broken firm is reported as failed, with its error',
      probe?.ok === false && !!probe.error,
      probe ? `probe firm row: ${JSON.stringify(probe)}` : 'probe firm is ABSENT from the results');
    // Name the failure, don't just count one: a firm that broke for some
    // unrelated reason would satisfy the check above and prove nothing about
    // the fixture we planted.
    record('the reported error is the planted parse failure',
      /JSON|token|Unexpected/i.test(probe?.error ?? ''),
      `probe firm error was: ${probe?.error ?? '(none)'}`);
    // Not skipped: a skipped row is also `ok: true`, and would prove only that
    // the fan-out never asked the firm — including when the platform has no
    // Anthropic key and every firm comes back `credentials_missing`.
    record('the other firm is still processed in the same run',
      !!clean && clean.ok === true && clean.skipped === undefined,
      clean ? `clean firm row: ${JSON.stringify(clean)}` : 'clean firm is absent from the results');
  }
}

async function teardown(): Promise<void> {
  const { data: firms } = await service.from('firms').select('id').in('slug', PROBE_SLUGS);
  const ids = (firms ?? []).map((f) => f.id as string);
  if (ids.length === 0) return;
  for (const table of ['files', 'file_analyses', 'firm_integrations', 'audit_log']) {
    const { error } = await service.from(table).delete().in('firm_id', ids);
    if (error && !/does not exist/.test(error.message)) {
      throw new Error(`teardown of ${table} failed: ${error.message}`);
    }
  }
  const { error } = await service.from('firms').delete().in('id', ids);
  if (error) throw new Error(`teardown of firms failed: ${error.message}`);
}

async function main() {
  console.log('══ cron fan-out probe ══\n');

  console.log('── static: does every cron fan out? ──');
  staticFanOutCheck();

  if (process.argv.includes('--static-only')) {
    return finish();
  }

  console.log('\n── teardown of any prior cron-probe run ──');
  await teardown();

  const firms = await provisionProbeFirms();
  console.log(`   probe firms ${PROBE_SLUG} = ${firms.probe}, ${BROKEN_SLUG} = ${firms.broken}, ${CLEAN_SLUG} = ${firms.clean}`);

  try {
    console.log('\n── in-process: forEachActiveFirm isolation over the real firms table ──');
    await fanOutIsolationCheck();

    console.log(`\n── live: ${BASE_URL} ──`);
    await liveProbe(firms);
  } finally {
    console.log('\n── teardown ──');
    await teardown();
  }

  finish();
}

function finish(): void {
  const failures = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failures.length}/${checks.length} checks pass`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail}`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await teardown(); } catch { /* best effort */ }
  process.exit(1);
});
