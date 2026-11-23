/**
 * Refresh one firm's stored status of companies and marks (subject_status)
 * now, the way /api/cron/subject-status does every five minutes.
 *
 *   npx tsx scripts/subject-status.ts <firmIdOrSlug>          # stale or out-of-date subjects
 *   npx tsx scripts/subject-status.ts <firmIdOrSlug> --all    # every company and mark
 */
import './load-env';
import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { refreshSubjectStatus } from '../lib/corporations/status-refresh';

async function resolveFirm(requested: string | undefined): Promise<{ id: string; slug: string }> {
  if (!requested) {
    console.error('Usage: npx tsx scripts/subject-status.ts <firmIdOrSlug> [--all]');
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
  if (process.argv.includes('--all')) {
    await db.from('subject_status').update({ stale: true }).in('type', ['corporation', 'trademark']);
  }
  const started = Date.now();
  const result = await refreshSubjectStatus(db, firm.id, { deadline: Date.now() + 10 * 60_000 });
  console.log(`${firm.slug}: ${result.refreshed} refreshed in ${((Date.now() - started) / 1000).toFixed(1)}s${result.remaining ? ' — more remain' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
