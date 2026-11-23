import { DEMO_CONFIG, assertDemoProject, assertMarkedDemo, findDemoFirm } from './common';
import { getSupabase } from '../../lib/supabase';
import { TENANT_TABLES } from '../../lib/tenancy/tables.generated';

/**
 * Delete the demo firm entirely — rows, storage objects, persona logins, the
 * firm itself — so scripts/demo/build.ts can start from nothing.
 *
 *   npx tsx scripts/demo/wipe.ts --yes
 *
 * Refuses any firm but the one firm.json names, on any project but the one the
 * fleet manifest serves the demo from, and a firm not marked
 * `settings.demo.enabled`. The sweep is the probes' teardown: every tenant
 * table rather than a hand-kept list, retried until a pass clears nothing new,
 * because FK order is not known here.
 */

const db = getSupabase();

async function removeUnder(bucket: string, prefix: string): Promise<number> {
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) return 0;
  let removed = 0;
  const objects: string[] = [];
  for (const entry of data ?? []) {
    const child = `${prefix}/${entry.name}`;
    if (entry.id === null) removed += await removeUnder(bucket, child);
    else objects.push(child);
  }
  if (objects.length > 0) {
    const { error: rmError } = await db.storage.from(bucket).remove(objects);
    if (rmError) throw new Error(`remove ${bucket}/${prefix}: ${rmError.message}`);
    removed += objects.length;
  }
  return removed;
}

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('This deletes the whole demo firm. Re-run with --yes.');
    process.exit(1);
  }
  assertDemoProject();

  const firm = await findDemoFirm(db);
  if (!firm) {
    console.log(`No "${DEMO_CONFIG.slug}" firm — nothing to wipe.`);
    return;
  }
  assertMarkedDemo(firm);

  const { data: team } = await db.from('team').select('auth_user_id').eq('firm_id', firm.id);
  const authIds = (team ?? []).map((t) => t.auth_user_id as string | null).filter((id): id is string => !!id);

  const { data: buckets } = await db.storage.listBuckets();
  for (const bucket of buckets ?? []) {
    const n = await removeUnder(bucket.id, firm.id);
    if (n > 0) console.log(`  storage ${bucket.id.padEnd(18)} ${n} objects`);
  }

  let remaining = [...TENANT_TABLES];
  for (let pass = 0; pass < 8 && remaining.length > 0; pass++) {
    const stuck: string[] = [];
    for (const table of remaining) {
      const { error } = await db.from(table).delete().eq('firm_id', firm.id);
      if (error && !/does not exist/.test(error.message)) stuck.push(table);
    }
    if (stuck.length === remaining.length) break;
    remaining = stuck;
  }
  if (remaining.length > 0) throw new Error(`could not clear: ${remaining.join(', ')}`);

  for (const id of authIds) {
    // A login that also belongs to an operator, or to someone at another
    // firm, is not the demo's to delete.
    const [{ data: op }, { data: staff }, { data: client }] = await Promise.all([
      db.from('platform_operators').select('auth_user_id').eq('auth_user_id', id).maybeSingle(),
      db.from('team').select('person_id').eq('auth_user_id', id).limit(1),
      db.from('client_users').select('id').eq('auth_user_id', id).limit(1),
    ]);
    if (op || (staff ?? []).length > 0 || (client ?? []).length > 0) continue;
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw new Error(`delete auth user ${id}: ${error.message}`);
  }

  const { error: domErr } = await db.from('firm_domains').delete().eq('firm_id', firm.id);
  if (domErr) throw new Error(`firm_domains: ${domErr.message}`);
  const { error: firmErr } = await db.from('firms').delete().eq('id', firm.id);
  if (firmErr) throw new Error(`firms: ${firmErr.message}`);

  console.log(`Wiped the demo firm ${firm.id} and ${authIds.length} persona logins.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
