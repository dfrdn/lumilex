import './load-env';
import './probe-websocket';
import { probeFetch } from './probe-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { mintId } from '../lib/ids';
import { firmStoragePath } from '../lib/tenancy/service-db';
import { TENANT_TABLES } from '../lib/tenancy/tables.generated';

/**
 * Storage-tenancy probe. `scripts/rls-probe.ts` covers Postgres; nothing
 * covered Supabase Storage, and the first cross-tenant leak of the rework
 * lived there (shared unprefixed template paths served one firm's letterhead
 * to another). This script closes that gap from two directions:
 *
 *   1. STATIC SWEEP — every `.storage.from(bucket).op(path)` call site in the
 *      codebase, classified by where its object key comes from. A key built by
 *      `firmStoragePath()` or read back from a DB column is firm-scoped by
 *      construction; a bare literal or template is a shared namespace. The
 *      known shared sites are listed in KNOWN_SHARED_PATHS with a verdict each,
 *      so the sweep is a ratchet: a NEW shared path fails the gate.
 *
 *   2. LIVE PROBE — provisions two disposable firms with real auth users,
 *      writes an object under each firm's prefix in every bucket, and asserts
 *      through PostgREST/Storage (the same path the app uses) that firm B's
 *      session cannot list, download, sign, overwrite or delete firm A's
 *      objects; that anon gets nothing from a private bucket; that a signed
 *      URL for an own-firm object works; and that the only public buckets are
 *      the two that are public on purpose.
 *
 *   3. HANDLER ATTACK PROBE — the two above prove Storage itself holds the
 *      line against a *browser* session. They say nothing about the app's own
 *      service-role handlers, which is where the line actually broke: a
 *      two-phase upload whose commit takes `storagePath` back from the client
 *      signs or records whatever it is handed. This part signs firm B in
 *      against the running dev server and performs the real attack — B
 *      confirming an upload that names a firm-A object — against every
 *      two-phase commit. Each attack is paired with a control that must
 *      SUCCEED, because a broken session makes every refusal look like
 *      security. Needs `npm run dev`; skipped (loudly) when it isn't up,
 *      or failed instead of skipped with --require-live.
 *
 * Usage:
 *   npx tsx scripts/storage-probe.ts               # sweep + live probe + handler attacks
 *   npx tsx scripts/storage-probe.ts --sweep-only  # no network, no fixtures
 *   npx tsx scripts/storage-probe.ts --require-live # a missing dev server is a failure
 *   PROBE_BASE_URL=http://127.0.0.1:3000 npx tsx scripts/storage-probe.ts
 *
 * Exits 1 on any violation.
 */

const ROOT = path.resolve(__dirname, '..');

// ── Bucket expectations ────────────────────────────────────────────
//
// `isPublic` is asserted, not observed: a bucket flipping to public is a leak
// of every object in it, and the two that are public are public on purpose.

type BucketSpec = {
  id: string;
  isPublic: boolean;
  why: string;
  contentType: string;
  /** Buckets the code writes to that may not exist in every environment. */
  optional?: boolean;
};

const MINI_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const BUCKETS: BucketSpec[] = [
  { id: 'files', isPublic: false, why: 'matter documents, deliverables, invoices', contentType: 'application/pdf' },
  { id: 'documents', isPublic: false, why: 'engagement agreements, affidavit review uploads', contentType: 'application/pdf' },
  { id: 'receipts', isPublic: false, why: 'reimbursement receipts', contentType: 'application/pdf' },
  { id: 'templates', isPublic: false, why: 'per-firm DOCX letterhead templates', contentType: DOCX_MIME },
  { id: 'avatars', isPublic: true, why: 'profile photos are served by public URL to logged-out chrome', contentType: 'image/png' },
  { id: 'issuances', isPublic: true, why: 'government issuance PDFs are public source material, deliberately public', contentType: 'application/pdf' },
  { id: 'chat-attachments', isPublic: false, why: 'chat message attachments', contentType: 'application/pdf' },
];

function bodyFor(spec: BucketSpec): Buffer {
  if (spec.contentType.startsWith('image/')) return MINI_PNG;
  return spec.contentType === DOCX_MIME ? Buffer.from('PK\x03\x04probe-docx') : MINI_PDF;
}

// ── Checks ─────────────────────────────────────────────────────────

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
const skipped: { name: string; why: string }[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '✗ FAIL'}  ${name}${pass ? '' : `  — ${detail}`}`);
}

function skip(name: string, why: string) {
  skipped.push({ name, why });
  console.log(`  SKIP  ${name}  — ${why}`);
}

// ══════════════════════════════════════════════════════════════════
//  PART 1 — static sweep
// ══════════════════════════════════════════════════════════════════

type Origin = 'firm-prefixed' | 'db-derived' | 'shared-literal' | 'unresolved';

type Site = {
  file: string;
  line: number;
  bucket: string;
  op: string;
  arg: string;
  origin: Origin;
  writes: boolean;
};

/** Ops that mint a NEW object key (a shared key here is a new shared object). */
const WRITE_OPS = new Set(['upload', 'createSignedUploadUrl', 'copy', 'move', 'uploadToSignedUrl']);

/**
 * Column names that carry an object key recorded at write time. A read through
 * one of these is only as firm-scoped as the row it came from — and the row is
 * reached through `getServiceDbForFirm` or an RLS-gated client, which the
 * rls-probe already covers.
 */
const KEY_COLUMNS = /\.(storage_path|file_url|path|pdf_path|template_storage_path|signature_url|engagement_file_path|logoPath|monogramPath|storagePath|fileUrl)\b/;

/**
 * Call sites whose object key is a shared (non-firm-prefixed) literal, each
 * with the verdict from the Phase 9 review. Entries are `file:bucket:op` —
 * line numbers would churn on every edit.
 *
 * These are NOT accepted as correct. They are the recorded backlog: the sweep
 * fails on anything not listed here, so the set can shrink but never grow
 * without a deliberate edit to this file.
 */
const KNOWN_SHARED_PATHS: Record<string, string> = {
  // ── Entity-id key, no firm segment ──────────────────────────────
  // The key is `<uuid-backed id>/…`, so two firms cannot collide and nothing
  // is guessable. It is still outside the firm prefix, which means
  // `/api/file-sign` and `/api/files/download` — both of which require the
  // prefix — refuse to serve it. Converting these is the remaining work.
  //
  // The four two-phase upload commits that used to head this list
  // (deliverable-file ×2, admin/file-upload, admin/file-bulk-create) plus the
  // reimbursement receipts and the shared `documents/affidavits/` folder were
  // converted in follow-up 1: they mint under `firmStoragePath()` now and
  // re-derive the same prefix at commit. Part 3 attacks each of them live.
  'app/api/status-report/route.ts:files:upload': 'entity-id key `<deliverableId>/v<n>/<name>`',
  'app/api/status-report/adhoc/route.ts:files:upload': 'entity-id key `<deliverableId>/v1/<name>`',
  'app/api/matters/[id]/exhibits/formal-offer/route.ts:files:upload': 'entity-id key `<fileId>/<name>`',

  // ── One shared folder for every tenant ──────────────────────────
  // A fixed literal prefix with per-entity leaves. The leaves are ids or
  // timestamps so nothing overwrites anything, but the folder is a single
  // cross-tenant namespace — the same shape as the template fallback that
  // served one firm's letterhead to another.
  'app/api/red-team/route.ts:files:upload': 'shared `documents/red-team/`',
  'app/api/proposals/[id]/export/route.ts:files:upload': 'shared `engagement-proposals/`',
  'app/api/finance/matter-billing/engagement/route.ts:documents:createSignedUploadUrl': 'shared `engagement-agreements/`',
  'app/api/finance/matter-billing/engagement/route.ts:documents:remove': 'shared `engagement-agreements/`',
  'app/api/portal/matters/[id]/files/upload/route.ts:files:createSignedUploadUrl': 'shared `client-uploads/<matterId>/`',

  // ── Public bucket on purpose ────────────────────────────────────
  'app/api/user/avatar/route.ts:avatars:upload': 'person-id key in the public avatars bucket',
  'app/api/user/headshot/route.ts:avatars:upload': 'person-id key in the public avatars bucket',
  'app/api/user/headshot/route.ts:avatars:getPublicUrl': 'person-id key in the public avatars bucket',
  'app/api/firm-profile/photo/route.ts:avatars:upload': 'shared `firm-profile/` in the public avatars bucket',
  'app/api/firm-profile/photo/route.ts:avatars:getPublicUrl': 'shared `firm-profile/` in the public avatars bucket',

  // ── Caller-supplied source, guarded at the call site ────────────
  // The classifier cannot see a guard, so the site stays listed with the
  // guard named. `attachAnnexes` copies FROM a client-supplied path: a
  // `source: matter` path is re-resolved against the deliverable's own matter
  // files, and a `source: upload` path is checked against this firm and
  // deliverable's temp annex prefix.
  'app/api/admin/finalize/route.ts:files:copy': 'copy source is client-supplied; guarded by allowedMatterFilePaths() and the annexTempPrefix() startsWith check',

  // ── Operator / fixture scripts (not request paths) ──────────────
  'scripts/seed-template-files.mjs:templates:upload': 'operator script',
  'scripts/seed-test-invoices.ts:files:upload': 'dev fixture script',
  'scripts/test-esign-seed.ts:documents:upload': 'dev fixture script',
  'scripts/test-esign-seed.ts:documents:remove': 'dev fixture script',
};

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(tsx?|mjs)$/.test(entry.name)) yield full;
  }
}

/** Text of the first call argument, balanced across nested parens/brackets. */
function firstArg(source: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < source.length && i < openParenIdx + 4000; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openParenIdx + 1, i).trim();
    } else if (ch === ',' && depth === 1) {
      return source.slice(openParenIdx + 1, i).trim();
    }
  }
  return source.slice(openParenIdx + 1, openParenIdx + 200).trim();
}

/** The first `${...}` of a template literal, or null when it starts with text. */
function leadingInterpolation(literal: string): string | null {
  const inner = literal.slice(1, -1);
  if (!inner.startsWith('${')) return null;
  let depth = 0;
  for (let i = 1; i < inner.length; i++) {
    if (inner[i] === '{') depth++;
    else if (inner[i] === '}') {
      depth--;
      if (depth === 0) return inner.slice(2, i);
    }
  }
  return null;
}

/**
 * Classify an object key expression by its FIRST path segment — that segment is
 * what puts the object inside or outside a firm's prefix. Local `const`/`let`
 * bindings are followed backwards from the call site (the nearest preceding
 * assignment wins, so a name reused in two branches resolves to the right one).
 */
function classify(expr: string, source: string, offset: number, depth = 0): Origin {
  let e = expr.trim();
  if (!e || depth > 5) return 'unresolved';

  // `[x]`, `[a, b]`, `paths.map(...)`, `xs.filter(...)` → judge the base.
  if (e.startsWith('[') && e.endsWith(']')) e = e.slice(1, -1).split(',')[0].trim();
  const mapped = e.match(/^([A-Za-z_$][\w$.]*)\s*\.\s*(?:map|filter|slice|flat)\s*\(/);
  if (mapped) e = mapped[1];

  if (/^firmStoragePath\s*\(/.test(e)) return 'firm-prefixed';

  // A helper that wraps firmStoragePath — the pattern to encourage, so follow
  // it rather than flagging it. Classified by what it returns. The helper is
  // looked for in this file first, then in the `@/` module it is imported from.
  const call = e.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (call && depth < 5) {
    const name = call[1].replace(/\$/g, '\\$');
    const fn = new RegExp(`function\\s+${name}\\s*\\([\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`);
    let home = source;
    let m = home.match(fn);
    if (!m) {
      const imp = source.match(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]@/([^'"]+)['"]`));
      const file = imp && ['.ts', '.tsx'].map((x) => path.join(ROOT, imp[1] + x)).find((f) => fs.existsSync(f));
      if (file) {
        home = fs.readFileSync(file, 'utf8');
        m = home.match(fn);
      }
    }
    const ret = m?.[1].match(/return\s+([\s\S]*?);/);
    if (ret) return classify(ret[1], home, m!.index!, depth + 1);
  }
  if (/^`/.test(e)) {
    const head = leadingInterpolation(e);
    return head ? classify(head, source, offset, depth + 1) : 'shared-literal';
  }
  if (/^['"]/.test(e)) return 'shared-literal';
  if (KEY_COLUMNS.test(e)) return 'db-derived';

  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    // Every assignment to this name before the call site, latest first. A
    // `let x: string | null = null` declaration followed by a branch that sets
    // the real key is the common shape, so a null initialiser is skipped over.
    const before = source.slice(0, offset);
    const name = e.replace(/\$/g, '\\$');
    const assignments: { index: number; rhs: string }[] = [];
    for (const re of [
      new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]+)?=\\s*([\\s\\S]*?);\\n`, 'g'),
      new RegExp(`\\n\\s*${name}\\s*=\\s*([\\s\\S]*?);\\n`, 'g'),
    ]) {
      for (let m = re.exec(before); m; m = re.exec(before)) {
        assignments.push({ index: m.index, rhs: m[1] });
      }
    }
    assignments.sort((a, b) => b.index - a.index);
    for (const a of assignments) {
      if (/^(null|undefined)$/.test(a.rhs.trim())) continue;
      return classify(a.rhs, source, a.index, depth + 1);
    }
  }
  // A parameter, a destructured binding, or a value from another module: the
  // key comes from the caller and is judged there.
  return 'unresolved';
}

function staticSweep(): Site[] {
  const sites: Site[] = [];
  const pattern = /\.storage\s*\.\s*from\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*(\w+)\s*\(/g;

  for (const dir of ['app', 'lib', 'components', 'hooks', 'scripts']) {
    for (const abs of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, abs);
      const source = fs.readFileSync(abs, 'utf-8');
      for (const m of source.matchAll(pattern)) {
        const openParen = m.index! + m[0].length - 1;
        const arg = firstArg(source, openParen);
        sites.push({
          file: rel,
          line: source.slice(0, m.index).split('\n').length,
          bucket: m[1],
          op: m[2],
          arg: arg.replace(/\s+/g, ' ').slice(0, 90),
          origin: classify(arg, source, m.index!),
          writes: WRITE_OPS.has(m[2]),
        });
      }
    }
  }
  return sites;
}

/**
 * A write mints a key, so it must be provably firm-prefixed (or a rewrite of a
 * key already recorded in a DB column). A read is only dangerous when its key
 * is a literal — that is the shape the template-fallback leak had; a read of a
 * caller-supplied key is judged where the key was minted.
 */
function isFinding(s: Site): boolean {
  return s.writes ? s.origin !== 'firm-prefixed' && s.origin !== 'db-derived' : s.origin === 'shared-literal';
}

function reportSweep(sites: Site[]): void {
  const byOrigin = (o: Origin) => sites.filter((s) => s.origin === o);
  console.log(
    `\n${sites.length} storage call sites: ` +
      `${byOrigin('firm-prefixed').length} firm-prefixed, ` +
      `${byOrigin('db-derived').length} db-derived, ` +
      `${byOrigin('shared-literal').length} shared-literal, ` +
      `${byOrigin('unresolved').length} caller-supplied\n`,
  );

  const flagged = sites.filter(isFinding);

  // Maintenance affordance: re-emit the backlog block after converting a batch
  // of call sites, instead of hand-editing keys.  STORAGE_PROBE_EMIT=1 …
  if (process.env.STORAGE_PROBE_EMIT) {
    const keys = [...new Set(flagged.map((s) => `${s.file}:${s.bucket}:${s.op}`))].sort();
    for (const k of keys) {
      const s = flagged.find((x) => `${x.file}:${x.bucket}:${x.op}` === k)!;
      console.log(`  '${k}': '${s.writes ? 'write' : 'read'} — ${s.arg}',`);
    }
    process.exit(0);
  }

  const seen = new Set<string>();
  const unlisted: Site[] = [];

  for (const s of flagged) {
    const key = `${s.file}:${s.bucket}:${s.op}`;
    seen.add(key);
    if (!(key in KNOWN_SHARED_PATHS)) unlisted.push(s);
  }

  console.log('── shared / unprefixed object keys (recorded backlog) ──');
  for (const key of Object.keys(KNOWN_SHARED_PATHS)) {
    const hit = flagged.find((s) => `${s.file}:${s.bucket}:${s.op}` === key);
    const mark = hit ? '  ' : '· ';
    console.log(`${mark}${key}\n     ${KNOWN_SHARED_PATHS[key]}${hit ? `  [${hit.arg}]` : '  (no longer present — prune)'}`);
  }

  record(
    'no NEW shared storage path',
    unlisted.length === 0,
    unlisted.length === 0
      ? 'backlog unchanged'
      : `unlisted shared keys:\n${unlisted.map((s) => `      ${s.file}:${s.line} ${s.bucket}.${s.op}(${s.arg})`).join('\n')}`,
  );

  const stale = Object.keys(KNOWN_SHARED_PATHS).filter((k) => !seen.has(k));
  if (stale.length > 0) {
    console.warn(`\nNote: ${stale.length} backlog entries no longer match a call site — prune them:`);
    for (const k of stale) console.warn(`  ${k}`);
  }

  const unresolvedWrites = sites.filter((s) => s.origin === 'unresolved' && s.writes);
  if (unresolvedWrites.length > 0) {
    console.log('\n── writes whose key comes from the caller (judged at the caller) ──');
    for (const s of unresolvedWrites) console.log(`   ${s.file}:${s.line} ${s.bucket}.${s.op}(${s.arg})`);
  }
}

// ══════════════════════════════════════════════════════════════════
//  PART 2 — live probe
// ══════════════════════════════════════════════════════════════════

const URL_ = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const PW = 'Storage-' + Math.random().toString(36).slice(2) + 'A1!';

const service = createClient(URL_, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EMAILS = {
  A: 'storage-probe-a@lumilex.test',
  B: 'storage-probe-b@lumilex.test',
};
const SLUGS = ['storage-probe-a', 'storage-probe-b'];

type Fixture = {
  firmId: string;
  personId: string;
  objects: Record<string, string>;
  /** Entity fixtures the handler attack probe (part 3) needs an owner for. */
  deliverableId: string;
  matterId: string;
  clientId: string;
  fileRowId: string;
  reimbursementId: string;
};
const fx: Record<'A' | 'B', Fixture> = {} as never;

async function provision(which: 'A' | 'B'): Promise<Fixture> {
  const slug = `storage-probe-${which.toLowerCase()}`;
  const { data: firm, error } = await service
    .from('firms')
    .insert({ slug, name: `Storage Probe ${which}`, short_name: `SP${which}` })
    .select('id')
    .single();
  if (error) throw new Error(`firm insert failed: ${error.message}`);
  const firmId = firm.id as string;

  const email = EMAILS[which];
  const { data: created, error: authErr } = await service.auth.admin.createUser({
    email, password: PW, email_confirm: true,
  });
  let authId: string;
  if (authErr) {
    const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
    const found = list?.users.find((u) => u.email === email);
    if (!found) throw new Error(`auth user create failed for ${email}: ${authErr.message}`);
    await service.auth.admin.updateUserById(found.id, { password: PW });
    authId = found.id;
  } else {
    authId = created.user.id;
  }

  const personId = mintId('user');
  // 'admin' rather than 'lawyer': /api/admin/file-bulk-create is role-gated,
  // and the attack probe has to reach the handler to attack it.
  const { error: teamErr } = await service.from('team').insert({
    notion_id: personId, person_id: personId, name: `Storage Probe ${which}`,
    email, role: 'admin', active: true, auth_user_id: authId, firm_id: firmId,
  });
  if (teamErr) throw new Error(`team insert failed: ${teamErr.message}`);

  // One object per bucket, under this firm's prefix — a deny check against an
  // empty bucket proves nothing.
  const objects: Record<string, string> = {};
  for (const spec of BUCKETS) {
    const key = firmStoragePath(firmId, `probe/${which.toLowerCase()}.bin`);
    const { error: upErr } = await service.storage
      .from(spec.id)
      .upload(key, bodyFor(spec), { contentType: spec.contentType, upsert: true });
    if (upErr) {
      if (spec.optional) continue;
      throw new Error(`fixture upload to ${spec.id} failed: ${upErr.message}`);
    }
    objects[spec.id] = key;
  }

  // Parent entities for the handler attack probe. Each handler's phase 2
  // derives its storage prefix from one of these, so both firms need one:
  // firm B attacks with its own id (path outside the prefix) and with firm A's
  // id (entity that isn't the caller's).
  const entities = {
    deliverableId: mintId('deliv'),
    matterId: mintId('matter'),
    clientId: mintId('client'),
    fileRowId: randomUUID(),
    reimbursementId: mintId('reimb'),
  };
  const label = `Storage Probe ${which}`;
  const seed: [string, Record<string, unknown>][] = [
    ['clients', { notion_id: entities.clientId, name: label, firm_id: firmId }],
    ['matters', { notion_id: entities.matterId, name: label, firm_id: firmId }],
    ['deliverables', { notion_id: entities.deliverableId, name: label, firm_id: firmId }],
    ['files', { notion_id: entities.fileRowId, name: label, matter_id: entities.matterId, firm_id: firmId, file_urls: [] }],
    ['reimbursements', {
      notion_id: entities.reimbursementId, expense: label, amount: 1,
      lawyer_ids: [personId], firm_id: firmId,
    }],
  ];
  for (const [table, row] of seed) {
    const { error } = await service.from(table).insert(row);
    if (error) throw new Error(`fixture ${table} insert failed: ${error.message}`);
  }

  return { firmId, personId, objects, ...entities };
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(URL_, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function bucketFlags(): Promise<Map<string, boolean>> {
  const { data, error } = await service.storage.listBuckets();
  if (error) throw new Error(`listBuckets failed: ${error.message}`);
  return new Map((data ?? []).map((b) => [b.id, b.public]));
}

async function liveProbe(): Promise<void> {
  console.log('── teardown of any prior storage-probe run ──');
  await teardown();

  console.log('── bucket inventory ──');
  const flags = await bucketFlags();
  for (const spec of BUCKETS) {
    if (!flags.has(spec.id)) {
      record(`bucket '${spec.id}' exists`, !!spec.optional,
        spec.optional
          ? 'declared optional; code writes to it but this project has no such bucket'
          : 'bucket referenced by the code is missing from this project');
      if (spec.optional) {
        console.log(`     note: code writes to '${spec.id}' but the bucket does not exist here`);
      }
      continue;
    }
    record(
      `bucket '${spec.id}' is ${spec.isPublic ? 'public on purpose' : 'private'}`,
      flags.get(spec.id) === spec.isPublic,
      `${spec.why} — expected public=${spec.isPublic}, got public=${flags.get(spec.id)}`,
    );
  }
  const unexpectedPublic = [...flags.entries()]
    .filter(([id, isPub]) => isPub && !BUCKETS.some((b) => b.id === id && b.isPublic))
    .map(([id]) => id);
  record('no unexpected public bucket', unexpectedPublic.length === 0,
    `public buckets not declared public: ${unexpectedPublic.join(', ')}`);

  console.log('── provisioning probe firms ──');
  fx.A = await provision('A');
  fx.B = await provision('B');
  const clientB = await signIn(EMAILS.B);
  const anon = createClient(URL_, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const spec of BUCKETS) {
    const keyA = fx.A.objects[spec.id];
    if (!keyA) continue;
    console.log(`── bucket '${spec.id}' ──`);
    const prefixA = firmStoragePath(fx.A.firmId, 'probe');

    // list
    {
      const { data, error } = await clientB.storage.from(spec.id).list(prefixA);
      const leaked = (data ?? []).length;
      record(`${spec.id}: firm-B session cannot list firm-A prefix`, !!error || leaked === 0,
        error ? `error (ok): ${error.message}` : `listed ${leaked} object(s) of firm A`);
    }

    // download — meaningless as an isolation check on a public bucket, where
    // every object is readable by anyone with the URL by definition. There the
    // isolation that matters is write isolation, checked below.
    {
      const { data, error } = await clientB.storage.from(spec.id).download(keyA);
      const bytes = data ? (await data.arrayBuffer()).byteLength : 0;
      if (spec.isPublic) {
        record(`${spec.id}: cross-firm read is INTENTIONAL (public bucket)`, true,
          `${spec.why}; firm B read ${bytes} bytes, as any reader can`);
      } else {
        record(`${spec.id}: firm-B session cannot download firm-A object`, !!error || bytes === 0,
          error ? `error (ok): ${error.message}` : `downloaded ${bytes} bytes of firm A's object`);
      }
    }

    // sign
    {
      const { data, error } = await clientB.storage.from(spec.id).createSignedUrl(keyA, 60);
      record(`${spec.id}: firm-B session cannot sign firm-A object`, !!error || !data?.signedUrl,
        error ? `error (ok): ${error.message}` : 'got a signed URL for firm A');
    }

    // overwrite
    {
      const { error } = await clientB.storage
        .from(spec.id)
        .upload(keyA, bodyFor(spec), { contentType: spec.contentType, upsert: true });
      record(`${spec.id}: firm-B session cannot overwrite firm-A object`, !!error,
        error ? `error (ok): ${error.message}` : 'overwrote firm A object');
    }

    // write into firm A's prefix
    {
      const planted = firmStoragePath(fx.A.firmId, 'probe/planted-by-b.bin');
      const { error } = await clientB.storage
        .from(spec.id)
        .upload(planted, bodyFor(spec), { contentType: spec.contentType });
      if (!error) await service.storage.from(spec.id).remove([planted]);
      record(`${spec.id}: firm-B session cannot write into firm-A prefix`, !!error,
        error ? `error (ok): ${error.message}` : `planted ${planted}`);
    }

    // delete
    {
      await clientB.storage.from(spec.id).remove([keyA]);
      const { data: still } = await service.storage
        .from(spec.id)
        .list(prefixA, { search: 'a.bin' });
      record(`${spec.id}: firm-B session cannot delete firm-A object`, (still ?? []).length === 1,
        `firm-A object ${(still ?? []).length === 1 ? 'survived' : 'was deleted by firm B'}`);
      if ((still ?? []).length !== 1) {
        await service.storage
          .from(spec.id)
          .upload(keyA, bodyFor(spec), { contentType: spec.contentType, upsert: true });
      }
    }

    // anon against a private bucket, over real HTTP (public buckets serve the
    // object URL without a token — that is what "public" means).
    {
      const { data, error } = await anon.storage.from(spec.id).download(keyA);
      const bytes = data ? (await data.arrayBuffer()).byteLength : 0;
      if (spec.isPublic) {
        record(`${spec.id}: anon read is INTENTIONAL (public bucket)`, true,
          `${spec.why}; anon ${error ? 'was refused via the authenticated path' : `read ${bytes} bytes`}`);
      } else {
        record(`${spec.id}: anon cannot download from private bucket`, !!error || bytes === 0,
          error ? `error (ok): ${error.message}` : `anon read ${bytes} bytes`);
      }
    }
    {
      const { data } = service.storage.from(spec.id).getPublicUrl(keyA);
      const res = await fetch(data.publicUrl);
      if (spec.isPublic) {
        record(`${spec.id}: public URL serves the object (intended)`, res.ok,
          `${spec.why} — HTTP ${res.status}`);
      } else {
        record(`${spec.id}: unsigned public URL is refused`, !res.ok, `HTTP ${res.status}`);
      }
    }

    // own-firm signed URL works (service-role path the app uses)
    {
      const { data, error } = await service.storage.from(spec.id).createSignedUrl(keyA, 60);
      const res = data?.signedUrl ? await fetch(data.signedUrl) : null;
      record(`${spec.id}: signed URL for an own-firm object works`, !!res?.ok,
        error ? `sign error: ${error.message}` : `HTTP ${res?.status}`);
    }
  }

  console.log('\n── handler attack probe: the app\'s own two-phase commits ──');
  await handlerAttackProbe();

  console.log('\n── legacy inventory (pre-existing objects, not a regression) ──');
  await legacyInventory();

  console.log('── teardown ──');
  await teardown();
}

// ══════════════════════════════════════════════════════════════════
//  PART 3 — handler attack probe
// ══════════════════════════════════════════════════════════════════

const BASE_URL = process.env.PROBE_BASE_URL ?? 'http://localhost:3000';

/**
 * The cookies `@supabase/ssr` would have written for a signed-in browser.
 * Driving the handlers needs cookies rather than a bearer token: `proxy.ts`
 * runs ahead of most of these routes and redirects to /login on a cookieless
 * request, so a bearer-only probe would score a 307 as a refusal and pass
 * every attack without ever reaching a handler.
 */
async function sessionCookie(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(URL_, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const c of list) jar.set(c.name, c.value); },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`handler probe sign-in failed for ${email}: ${error.message}`);
  return [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ');
}

type Reply = { status: number; body: string; json: Record<string, unknown> };

async function post(pathname: string, cookie: string, body: unknown): Promise<Reply> {
  const res = await probeFetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* redirect or HTML */ }
  return { status: res.status, body: text, json };
}

async function patch(pathname: string, cookie: string, body: unknown): Promise<Reply> {
  const res = await probeFetch(`${BASE_URL}${pathname}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* redirect or HTML */ }
  return { status: res.status, body: text, json };
}

/** A refusal that still leaked a storage URL is not a refusal. */
function leaksSignedUrl(reply: Reply): boolean {
  return /\/storage\/v1\/object\/(sign|upload\/sign)\//.test(reply.body);
}

function refused(reply: Reply): boolean {
  return reply.status >= 400 && reply.status < 500 && !leaksSignedUrl(reply);
}

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await probeFetch(`${BASE_URL}/login`, { redirect: 'manual' });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function handlerAttackProbe(): Promise<void> {
  const ATTACKS = [
    'handler: deliverable-file/upload-url commit refuses a firm-A object',
    'handler: deliverable-file commit refuses a firm-A object and returns no signed URL',
    'handler: deliverable-file mint refuses a firm-A deliverable id',
    'handler: reimbursement commit refuses a firm-A receipt',
    'handler: reimbursement edit-mint refuses a firm-A reimbursement id',
    'handler: reimbursement PATCH refuses a firm-A receipt',
    'handler: admin/file-upload commit refuses a firm-A object',
    'handler: admin/file-upload refuses a firm-A files row',
    'handler: admin/file-bulk-create commit refuses a firm-A object',
    'handler: affidavit-review refuses a firm-A object',
  ];

  if (!(await serverIsUp())) {
    const why = `no dev server at ${BASE_URL} — run \`npm run dev\` (or set PROBE_BASE_URL)`;
    if (process.argv.includes('--require-live')) {
      for (const name of ATTACKS) record(name, false, why);
    } else {
      for (const name of ATTACKS) skip(name, why);
    }
    return;
  }

  const cookie = await sessionCookie(EMAILS.B);
  const victimFile = fx.A.objects['files'];
  const victimReceipt = fx.A.objects['receipts'];
  const bPrefix = firmStoragePath(fx.B.firmId, '');

  // ── Control: the session works and the handler is reachable ──────
  // Every deny check below is worthless if this one fails: a rejected session
  // refuses the attack too, for the wrong reason.
  const mint = await post('/api/deliverable-file/upload-url', cookie, {
    deliverableId: fx.B.deliverableId,
    files: [{ name: 'probe upload.pdf', size: MINI_PDF.length, type: 'application/pdf' }],
  });
  const minted = (mint.json.uploads as { storagePath: string; signedUrl: string }[] | undefined)?.[0];
  record(
    'handler probe control: firm B can mint an upload URL for its own deliverable',
    mint.status === 200 && !!minted?.storagePath.startsWith(bPrefix),
    `HTTP ${mint.status} — ${mint.body.slice(0, 200)}`,
  );
  if (!minted) {
    for (const name of ATTACKS) skip(name, 'control failed — the session never reached a handler');
    return;
  }

  await fetch(minted.signedUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: new Uint8Array(MINI_PDF),
  });
  const commit = await post('/api/deliverable-file/upload-url', cookie, {
    confirm: true,
    deliverableId: fx.B.deliverableId,
    version: 1,
    uploads: [{ storagePath: minted.storagePath, name: 'probe upload.pdf', size: MINI_PDF.length }],
  });
  const { data: ownRows } = await service
    .from('deliverable_files')
    .select('file_url')
    .eq('deliverable_id', fx.B.deliverableId);
  record(
    'handler probe control: firm B can commit its own upload',
    commit.status === 200 && (ownRows ?? []).some((r) => r.file_url === minted.storagePath),
    `HTTP ${commit.status} — ${commit.body.slice(0, 200)}; rows: ${JSON.stringify(ownRows)}`,
  );

  // ── Attack 1 — commit a firm-A object onto firm B's own deliverable ──
  {
    const reply = await post('/api/deliverable-file/upload-url', cookie, {
      confirm: true,
      deliverableId: fx.B.deliverableId,
      version: 1,
      uploads: [{ storagePath: victimFile, name: 'stolen.pdf', size: 1 }],
    });
    const { data: rows } = await service
      .from('deliverable_files')
      .select('file_url')
      .eq('file_url', victimFile);
    record(ATTACKS[0], refused(reply) && (rows ?? []).length === 0,
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}; rows recorded: ${(rows ?? []).length}`);
  }

  // ── Attack 2 — the sibling route, which signs and returns the URL ──
  {
    const reply = await post('/api/deliverable-file', cookie, {
      confirm: true,
      deliverableId: fx.B.deliverableId,
      version: 1,
      uploads: [{ storagePath: victimFile, name: 'stolen.pdf', size: 1 }],
    });
    const { data: rows } = await service
      .from('deliverable_files')
      .select('file_url')
      .eq('file_url', victimFile);
    record(ATTACKS[1], refused(reply) && (rows ?? []).length === 0,
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}; rows recorded: ${(rows ?? []).length}`);
  }

  // ── Attack 3 — the entity id itself, which a prefix check alone trusts ──
  {
    const reply = await post('/api/deliverable-file/upload-url', cookie, {
      deliverableId: fx.A.deliverableId,
      files: [{ name: 'x.pdf', size: 1, type: 'application/pdf' }],
    });
    record(ATTACKS[2], reply.status === 404 && !leaksSignedUrl(reply),
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}`);
  }

  // ── Attack 4 — reimbursement commit: a YEAR-long signed URL ──────
  {
    const tempId = mintId('reimb');
    const reply = await post('/api/reimbursement', cookie, {
      confirm: true,
      tempId,
      expense: 'Storage probe',
      amount: '1',
      expenseCategory: 'Transportation',
      expenseDate: '2026-08-24',
      clientId: fx.B.clientId,
      receipts: [{ name: 'stolen.pdf', storagePath: victimReceipt }],
    });
    const { data: rows } = await service
      .from('reimbursements')
      .select('notion_id, receipt_urls')
      .eq('firm_id', fx.B.firmId);
    const leaked = (rows ?? []).filter((r) =>
      JSON.stringify(r.receipt_urls ?? []).includes(fx.A.firmId),
    );
    record(ATTACKS[3], refused(reply) && leaked.length === 0,
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}; rows holding a firm-A receipt: ${leaked.length}`);
  }

  // ── Attack 5 — phase 1 into another firm's receipt folder ────────
  {
    const reply = await post('/api/reimbursement', cookie, {
      reimbursementId: fx.A.reimbursementId,
      receipts: [{ name: 'x.pdf', type: 'application/pdf', size: 1 }],
    });
    record(ATTACKS[4], refused(reply),
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}`);
  }

  // ── Attack 6 — reimbursement PATCH addReceipts ───────────────────
  {
    const reply = await patch('/api/reimbursement', cookie, {
      notionId: fx.B.reimbursementId,
      addReceipts: [{ name: 'stolen.pdf', storagePath: victimReceipt }],
    });
    const { data: row } = await service
      .from('reimbursements')
      .select('receipt_urls')
      .eq('notion_id', fx.B.reimbursementId)
      .maybeSingle();
    const stored = JSON.stringify(row?.receipt_urls ?? []);
    record(ATTACKS[5], refused(reply) && !stored.includes(fx.A.firmId),
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}; receipt_urls: ${stored.slice(0, 200)}`);
  }

  // ── Attack 7/8 — admin/file-upload: bad path, and someone else's row ──
  {
    const reply = await post('/api/admin/file-upload', cookie, {
      notionId: fx.B.fileRowId,
      confirm: true,
      uploads: [{ name: 'stolen.pdf', storagePath: victimFile }],
    });
    const { data: row } = await service
      .from('files')
      .select('file_urls')
      .eq('notion_id', fx.B.fileRowId)
      .maybeSingle();
    const stored = JSON.stringify(row?.file_urls ?? []);
    record(ATTACKS[6], refused(reply) && !stored.includes(fx.A.firmId),
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}; file_urls: ${stored.slice(0, 200)}`);
  }
  {
    const reply = await post('/api/admin/file-upload', cookie, {
      notionId: fx.A.fileRowId,
      files: [{ name: 'x.pdf', type: 'application/pdf' }],
    });
    record(ATTACKS[7], reply.status === 404 && !leaksSignedUrl(reply),
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}`);
  }

  // ── Attack 9 — admin/file-bulk-create commit ─────────────────────
  {
    const forgedRowId = randomUUID();
    const reply = await post('/api/admin/file-bulk-create', cookie, {
      confirm: true,
      matterId: fx.B.matterId,
      rows: [{ notionId: forgedRowId, name: 'Stolen', storagePath: victimFile, originalName: 'stolen.pdf' }],
    });
    const { data: rows } = await service
      .from('files')
      .select('notion_id')
      .eq('notion_id', forgedRowId);
    record(ATTACKS[8], refused(reply) && (rows ?? []).length === 0,
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}; rows created: ${(rows ?? []).length}`);
  }

  // ── Attack 10 — affidavit-review: the shared-folder prefix check ──
  {
    const reply = await post('/api/affidavit-review', cookie, {
      storagePath: victimFile,
      name: 'stolen.pdf',
      mode: 'self',
    });
    const { data: rows } = await service
      .from('affidavit_reviews')
      .select('id')
      .eq('storage_path', victimFile);
    record(ATTACKS[9], refused(reply) && (rows ?? []).length === 0,
      `HTTP ${reply.status} — ${reply.body.slice(0, 200)}; reviews created: ${(rows ?? []).length}`);
  }
}

/**
 * Objects already in the buckets whose first path segment is not a firm id.
 * They predate the rework (the fork imported them) — reported so the count is
 * visible and shrinking, never asserted on.
 */
async function legacyInventory(): Promise<void> {
  for (const spec of BUCKETS) {
    const { data: top, error: listErr } = await service.storage
      .from(spec.id)
      .list('', { limit: 1000 });
    if (listErr) continue;
    const isFirmId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const legacy = (top ?? []).filter((e) => !isFirmId.test(e.name));
    const prefixed = (top ?? []).filter((e) => isFirmId.test(e.name));
    console.log(
      `   ${spec.id}: ${prefixed.length} firm-prefixed top-level entr${prefixed.length === 1 ? 'y' : 'ies'}, ` +
        `${legacy.length} legacy${legacy.length ? ` (${legacy.slice(0, 6).map((e) => e.name).join(', ')}${legacy.length > 6 ? ', …' : ''})` : ''}`,
    );
  }
}

/**
 * Everything under one prefix, folders included. The handler attack probe
 * makes the app mint its own keys (`<firm>/<deliverableId>/v1/…`), so cleanup
 * can't assume the fixture layout — and it has to work on the opening teardown
 * of a crashed run, with nothing in memory.
 */
async function removeUnder(bucket: string, prefix: string): Promise<void> {
  const { data, error } = await service.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) return;
  const objects: string[] = [];
  for (const entry of data ?? []) {
    const child = `${prefix}/${entry.name}`;
    if (entry.id === null) await removeUnder(bucket, child);
    else objects.push(child);
  }
  if (objects.length > 0) await service.storage.from(bucket).remove(objects);
}

async function teardown(): Promise<void> {
  const { data: firms } = await service.from('firms').select('id').in('slug', SLUGS);
  const firmIds = (firms ?? []).map((f) => f.id as string);

  for (const spec of BUCKETS) {
    for (const firmId of firmIds) {
      await removeUnder(spec.id, firmId);
    }
  }

  if (firmIds.length > 0) {
    // Sweep every tenant table rather than a hand-kept list: the handler attack
    // probe drives real endpoints, and a handler (or a trigger behind one) can
    // write a table this script never names. FK order isn't known, so retry
    // until a pass clears nothing new.
    let remaining = [...TENANT_TABLES];
    for (let pass = 0; pass < 5 && remaining.length > 0; pass++) {
      const stuck: string[] = [];
      for (const table of remaining) {
        const { error } = await service.from(table).delete().in('firm_id', firmIds);
        if (error && !/does not exist/.test(error.message)) stuck.push(table);
      }
      if (stuck.length === remaining.length) break;
      remaining = stuck;
    }
    if (remaining.length > 0) {
      throw new Error(`teardown could not clear: ${remaining.join(', ')}`);
    }
    const { error } = await service.from('firms').delete().in('id', firmIds);
    if (error) throw new Error(`teardown of firms failed: ${error.message}`);
  }

  const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list?.users ?? []) {
    if (u.email && Object.values(EMAILS).includes(u.email)) {
      await service.auth.admin.deleteUser(u.id);
    }
  }
}

// ══════════════════════════════════════════════════════════════════

async function main() {
  console.log('══ storage probe ══\n');
  console.log('── static sweep: where does each object key come from? ──');
  reportSweep(staticSweep());

  if (!process.argv.includes('--sweep-only')) {
    console.log('\n── live probe ──');
    await liveProbe();
  }

  const failures = checks.filter((c) => !c.pass);
  console.log(
    `\n${checks.length - failures.length}/${checks.length} checks pass` +
      (skipped.length > 0 ? `, ${skipped.length} skipped` : ''),
  );
  if (skipped.length > 0) {
    console.log(
      `\nSkipped (re-run with the dev server up, or --require-live to fail instead):\n` +
        skipped.map((s) => `  · ${s.name}\n      ${s.why}`).join('\n'),
    );
  }
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
