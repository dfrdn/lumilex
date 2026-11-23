import { assertDemoProject, assertMarkedDemo, findDemoFirm } from './common';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { getSupabase } from '../../lib/supabase';
import { getServiceDbForFirm } from '../../lib/tenancy/service-db';
import { MATTER_STATUS } from '../../lib/matter-status';
import { probeFetch } from '../probe-fetch';

/**
 * The demo's one-time AI pass, run after scripts/demo/build.ts and before the
 * golden snapshot, so that what visitors see is already analysed and costs
 * nothing per visit:
 *
 *   npm run dev                        # in another terminal
 *   npx tsx scripts/demo/cap-ai.ts --off
 *   npx tsx scripts/demo/ai-pass.ts
 *   npx tsx scripts/demo/cap-ai.ts
 *
 * It drives the app's own per-firm cron handlers against the dev server
 * (PROBE_BASE_URL, default http://localhost:3000) rather than reimplementing
 * them — the same code that keeps a real firm's artifacts current. They fan
 * out to every firm with the feature, and only the demo firm on this project
 * has its AI switched on. Then it fills document text for keyword search and
 * distils the Library pages from the matters.
 */

const BASE = process.env.PROBE_BASE_URL ?? 'http://localhost:3000';
const ROOT = path.resolve(__dirname, '..', '..');

async function cron(route: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await probeFetch(`${BASE}${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    // A batch of model calls takes minutes, not probeFetch's 20s; a timeout
    // there would retry, and run the same batch twice.
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function script(file: string, args: string[]): void {
  console.log(`\n$ npx tsx ${file} ${args.join(' ')}`);
  execFileSync('npx', ['tsx', file, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--experimental-websocket' },
  });
}

async function main() {
  assertDemoProject();
  if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET is not set in .env.local.');

  const firm = await findDemoFirm(getSupabase());
  if (!firm) throw new Error('No demo firm — run scripts/demo/build.ts first.');
  assertMarkedDemo(firm);
  if (firm.settings.aiLimits) {
    throw new Error('The demo’s AI ceiling is on and this pass would spend it. Run scripts/demo/cap-ai.ts --off first.');
  }
  const db = getServiceDbForFirm(firm.id);

  console.log('Incoming file analyses');
  for (let offset = 0, round = 0; round < 30; round++, offset += 10) {
    const r = await cron('/api/file-analysis/backfill', { offset });
    console.log(`  offset ${offset}: processed ${r.processed}, skipped ${r.skipped}, errors ${r.errors}`);
    if (r.done) break;
  }

  console.log('\nFinalized deliverable versions');
  script('scripts/backfill-deliverable-versions.ts', []);

  console.log('\nMatter summaries');
  for (let round = 0; round < 20; round++) {
    const r = await cron('/api/matter-summary/batch', { batchSize: 5 }, {
      'x-cron-secret': process.env.CRON_SECRET!,
    });
    console.log(`  total ${r.total}, succeeded ${r.succeeded}, failed ${r.failed}`);
    if (!r.total) break;
  }

  console.log('\nMatter health');
  const { data: matters } = await db
    .from('matters')
    .select('notion_id')
    .eq('status', MATTER_STATUS.ONGOING);
  const now = new Date().toISOString();
  for (const m of matters ?? []) {
    const { error } = await db
      .from('matter_health')
      .upsert({ matter_id: m.notion_id, needs_refresh: true, refresh_requested_at: now }, { onConflict: 'matter_id' });
    if (error) throw new Error(`matter_health flag: ${error.message}`);
  }
  for (let round = 0; round < 20; round++) {
    const r = await cron('/api/matter-health/refresh-stale', { limit: 25 });
    console.log(`  processed ${r.processed}, errors ${r.errors}, remaining ${r.remaining}`);
    if (!r.remaining) break;
  }

  console.log('\nDocument text for keyword search');
  script('scripts/backfill-file-text.ts', ['demo']);

  console.log('\nEmbeddings');
  const e = await cron('/api/embeddings/generate', { backfill: true });
  console.log(`  ${JSON.stringify(e).slice(0, 300)}`);

  console.log('\nLibrary pages distilled from the matters');
  script('scripts/backfill-kb.ts', ['--firm', 'demo', '--min', '1']);

  console.log('\nDone. Next: npx tsx scripts/demo/cap-ai.ts, then the snapshot (docs/demo-instance.md).');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
