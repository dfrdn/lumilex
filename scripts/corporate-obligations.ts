/**
 * Show — or with --apply, raise — the next GIS / AFS / ITR filings and permit
 * renewal tasks the nightly roll-forward would create for one firm
 * (lib/corporations/roll-forward.ts, /api/cron/corporate-obligations).
 *
 * Usage:
 *   npx tsx scripts/corporate-obligations.ts <firmIdOrSlug>            # dry run
 *   npx tsx scripts/corporate-obligations.ts <firmIdOrSlug> --apply    # write
 */
import './load-env';
import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { rollForwardObligations } from '../lib/corporations/roll-forward';

async function resolveFirm(requested: string | undefined): Promise<{ id: string; slug: string }> {
  if (!requested) {
    console.error('Usage: npx tsx scripts/corporate-obligations.ts <firmIdOrSlug> [--apply]');
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
  const apply = process.argv.includes('--apply');
  const result = await rollForwardObligations(getServiceDbForFirm(firm.id), firm.id, { dryRun: !apply });

  console.log(`${apply ? 'APPLIED' : 'DRY RUN'} — ${firm.slug}, today ${result.today}`);
  for (const e of result.entries) {
    console.log(`\n${e.corporation}  [matter: ${e.matterName ?? '—'}, team of ${e.assignees.length}]${e.skipped ? `  SKIPPED: ${e.skipped}` : ''}`);
    for (const f of e.filings) console.log(`  ${f.dueDate}${f.provisional ? ' (provisional)' : '              '}  ${f.name}`);
    if (e.permit) console.log(`  ${e.permit.dueDate}  ${e.permit.name}  (task)`);
  }
  const planned = result.entries.reduce((n, e) => n + e.filings.length, 0);
  console.log(`\n${planned} filing(s) ${apply ? `planned, ${result.created} created` : 'would be created'}; ${result.entries.filter((e) => e.permit).length} permit task(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
