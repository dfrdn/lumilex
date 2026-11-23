/**
 * Backfill extracted_text for one firm's incoming-file analyses that have none.
 *
 * Incoming PDFs are analyzed through the Claude Files API, so the model reads
 * them but nothing stored their text. Keyword search ("Exact matches") and
 * text-based embeddings need it. For each row: the local parser first (free,
 * nothing leaves the firm), then Claude transcribing the scan when the PDF has
 * no text layer — only when the firm has `ai_analysis` on, as the live path.
 *
 * Usage: npx tsx scripts/backfill-file-text.ts <firmIdOrSlug> [--dry-run] [--limit=N]
 *        [--concurrency=3] [--no-transcribe] [--no-reembed]
 *
 * Run locally (the serverless maxDuration would kill it). Each processed row
 * is idempotent, so the script can be stopped and rerun.
 */
import './load-env';
import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { ensureIncomingFileText, type TextOutcome } from '../lib/ai/document-text';

const argFlag = (name: string) => process.argv.includes(`--${name}`);
const argNum = (name: string, dflt: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  const n = a ? Number(a.split('=')[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

const DRY_RUN = argFlag('dry-run');
const TRANSCRIBE = !argFlag('no-transcribe');
const REEMBED = !argFlag('no-reembed');
const LIMIT = argNum('limit', 0);
const CONCURRENCY = argNum('concurrency', 3);

async function resolveFirm(requested: string | undefined): Promise<{ id: string; slug: string }> {
  if (!requested) {
    console.error('Usage: npx tsx scripts/backfill-file-text.ts <firmIdOrSlug> [--dry-run] [--limit=N] [--concurrency=3] [--no-transcribe] [--no-reembed]');
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

async function main() {
  const firm = await resolveFirm(process.argv.slice(2).find((a) => !a.startsWith('--')));
  const db = getServiceDbForFirm(firm.id);

  const ids: number[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('file_analyses')
      .select('id')
      .eq('status', 'completed')
      .not('file_id', 'is', null)
      .or('extracted_text.is.null,extracted_text.eq.')
      .order('id', { ascending: false })
      .range(from, from + 999);
    if (error) { console.error('Query failed:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    ids.push(...data.map((r: { id: number }) => r.id));
    if (data.length < 1000) break;
  }

  const total = ids.length;
  const work = LIMIT ? ids.slice(0, LIMIT) : ids;
  console.log(`[file-text] ${firm.slug}: ${total} incoming analyses without text; processing ${work.length}${DRY_RUN ? ' (dry run)' : ''}; transcribe=${TRANSCRIBE} reembed=${REEMBED} concurrency=${CONCURRENCY}`);
  if (DRY_RUN) return;

  const counts: Record<TextOutcome, number> = { skipped: 0, parsed: 0, transcribed: 0, empty: 0, error: 0 };
  let done = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const started = Date.now();

  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= work.length) return;
      const id = work[i];
      const r = await ensureIncomingFileText(firm.id, id, { transcribe: TRANSCRIBE, reembed: REEMBED });
      counts[r.outcome] += 1;
      if (r.tokens) { inputTokens += r.tokens.input; outputTokens += r.tokens.output; }
      done += 1;
      const tag = r.outcome === 'error' ? `error: ${r.error}` : `${r.outcome} (${r.chars} chars)`;
      console.log(`[file-text] ${done}/${work.length} #${id} ${tag}`);
      await new Promise((res) => setTimeout(res, 150));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`[file-text] Done in ${mins} min:`, counts, `tokens in=${inputTokens} out=${outputTokens}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
