// The public demo's reset, run inside the Supabase project that serves it.
//
// Deployed to that one project only (fleet/instances.json → demo.lumilex.co)
// and called only by pg_cron through demo_snapshot.invoke() — see
// scripts/demo/reset.sql, which installs the SQL half and the schedule. It is
// not part of any firm's instance: nothing in the app calls it and no
// migration creates it.
//
//   { action: 'snapshot' }  demo_snapshot.take(), then a golden copy of every
//                           seeded object into the private demo-golden bucket.
//   { action: 'reset' }     demo_snapshot.restore(), then storage put back to
//                           the manifest: missing seeded objects copied back
//                           from demo-golden, visitor uploads removed.
//
// Authenticated by a secret only the database knows: the cron job reads it
// from the Vault and sends it; this reads the same Vault entry and compares.
// Deployed with JWT verification off, because the anon key that would satisfy
// it is public. Anything else gets a bare 404.

import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GOLDEN = 'demo-golden';
const CONCURRENCY = 8;

async function inBatches<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
  try {
    const [row] = await sql<{ secret: string }[]>`
      select decrypted_secret as secret from vault.decrypted_secrets where name = 'demo_reset_secret'`;
    const given = req.headers.get('x-demo-reset') ?? '';
    if (!row?.secret || !timingSafeEqual(given, row.secret)) {
      return new Response('Not found', { status: 404 });
    }

    const { action } = await req.json().catch(() => ({ action: null }));
    if (action !== 'snapshot' && action !== 'reset') {
      return new Response('Unknown action', { status: 400 });
    }

    const [firm] = await sql<{ id: string }[]>`
      select id from public.firms
       where slug = 'demo' and coalesce((settings->'demo'->>'enabled')::boolean, false)`;
    if (!firm) return new Response('No demo firm', { status: 409 });

    const storage = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    ).storage;

    if (action === 'snapshot') {
      const [{ take }] = await sql<{ take: string }[]>`select demo_snapshot.take(${firm.id}) as take`;
      const manifest = await sql<{ bucket_id: string; name: string }[]>`
        select bucket_id, name from demo_snapshot.objects`;
      // Golden copies from an earlier build (a wiped firm's prefix) go first.
      const stale = await sql<{ name: string }[]>`
        select o.name from storage.objects o
         where o.bucket_id = ${GOLDEN}
           and not exists (
             select 1 from demo_snapshot.objects m where m.bucket_id || '/' || m.name = o.name)`;
      for (let i = 0; i < stale.length; i += 100) {
        await storage.from(GOLDEN).remove(stale.slice(i, i + 100).map((o) => o.name));
      }
      const failed: string[] = [];
      await inBatches(manifest, async (o) => {
        const { error } = await storage
          .from(o.bucket_id)
          .copy(o.name, `${o.bucket_id}/${o.name}`, { destinationBucket: GOLDEN });
        if (error && !/already exists/i.test(error.message)) failed.push(`${o.bucket_id}/${o.name}: ${error.message}`);
      });
      const body = { action, take, golden: manifest.length - failed.length, failed };
      console.log(JSON.stringify(body));
      return Response.json(body, { status: failed.length ? 500 : 200 });
    }

    const [{ restore }] = await sql<{ restore: string }[]>`select demo_snapshot.restore(${firm.id}) as restore`;

    const missing = await sql<{ bucket_id: string; name: string }[]>`
      select m.bucket_id, m.name from demo_snapshot.objects m
       where not exists (
         select 1 from storage.objects o where o.bucket_id = m.bucket_id and o.name = m.name)`;
    const extra = await sql<{ bucket_id: string; name: string }[]>`
      select o.bucket_id, o.name from storage.objects o
       where o.name like ${firm.id + '/%'} and o.bucket_id <> ${GOLDEN}
         and not exists (
           select 1 from demo_snapshot.objects m where m.bucket_id = o.bucket_id and m.name = o.name)`;

    const failed: string[] = [];
    await inBatches(missing, async (o) => {
      const { error } = await storage
        .from(GOLDEN)
        .copy(`${o.bucket_id}/${o.name}`, o.name, { destinationBucket: o.bucket_id });
      if (error) failed.push(`restore ${o.bucket_id}/${o.name}: ${error.message}`);
    });

    const byBucket = new Map<string, string[]>();
    for (const o of extra) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o.name]);
    for (const [bucket, names] of byBucket) {
      for (let i = 0; i < names.length; i += 100) {
        const { error } = await storage.from(bucket).remove(names.slice(i, i + 100));
        if (error) failed.push(`remove ${bucket}: ${error.message}`);
      }
    }

    const body = { action, restore, restoredObjects: missing.length, removedObjects: extra.length, failed };
    console.log(JSON.stringify(body));
    return Response.json(body, { status: failed.length ? 500 : 200 });
  } catch (err) {
    console.error(err);
    return new Response(err instanceof Error ? err.message : 'failed', { status: 500 });
  } finally {
    await sql.end();
  }
});
