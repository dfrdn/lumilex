# Lumilex — Agent Notes

How this codebase wants to be edited. Project overview lives in [README.md](README.md); this file is the editing contract.

## Stack at a glance
Next.js 16 (App Router) · React 19 · TypeScript 5 · Supabase Postgres · Supabase Auth (`@supabase/ssr`) · Tailwind v4 · Anthropic Claude · Voyage embeddings · Microsoft Graph (Outlook + SharePoint) · Resend · web-push · Vercel.

## Database

- **Baseline**: [supabase/migrations/00000000000001_baseline.sql](supabase/migrations/00000000000001_baseline.sql) — the authoritative schema, generated 2026-08-22 by introspecting the live origin project's catalog. It bootstraps a fresh database (raw extraction pieces in [supabase/baseline-work/](supabase/baseline-work/)).
- **History**: the pre-baseline migration journal from the origin era was removed from the tree on 2026-11-01 and survives only in git history; it had drifted (early migrations were applied via SQL Editor and never committed) and cannot rebuild a database. Never apply anything from it.
- **New migrations**: [supabase/migrations/](supabase/migrations/), one `.sql` per change, `YYYYMMDD_short_description.sql` after the baseline, **plus an entry in [supabase/migration-versions.json](supabase/migration-versions.json)**. Keep them idempotent — `IF NOT EXISTS` on `CREATE`, guarded `ADD COLUMN`, check before `INSERT`-seeding.
- **Replay order is the version map, not the filename.** Filenames sort alphabetically within a day, which is not the order they were applied in (`firm_allocators` sorts ahead of `firms_foundation`, which it depends on). The map holds the version each file was applied under on the test instance — the same `version` its ledger holds — and `npm test` fails while a file has no entry.
- **Apply order (important)**: the test instance first, then the fleet. Apply to the test project (`jmwcsldskeycpgqtbcyx`) via `mcp__supabase__apply_migration` in the same turn you write the file. The local stack (`supabase start`, below) is for trying a migration first, never a substitute for the test instance. Name it the filename without its date prefix (`views_security_invoker` for `20260925_views_security_invoker.sql`): `fleet:migrate` compares that name with the ledger and refuses the instance on a mismatch, and a refused test instance holds back every firm. Then read the version it recorded (`list_migrations`) into the version map. A fix applied as a second migration is folded into the file, and its ledger row goes on the list in [docs/multitenancy-followups.md](docs/multitenancy-followups.md). Firm instances are brought current with `npm run fleet:migrate -- --apply`, which refuses to touch a firm while the test instance has anything pending. The origin app's production project must never receive Lumilex migrations; [lib/fleet/manifest.ts](lib/fleet/manifest.ts) refuses it by the hash of its ref.
- **A fresh database is built by `npm run db:bootstrap`** ([scripts/bootstrap-database.ts](scripts/bootstrap-database.ts)), never by `supabase db push` / `db reset`, which apply by filename and are switched off in [supabase/config.toml](supabase/config.toml). It replays everything in version-map order, writes the same ledger `fleet:migrate` reads, puts `app_base_url` and `cron_secret` in the Vault (without them three triggers roll back the statement that fired them), and deletes the `dev` firm the early migrations seed. `npm run setup:local` wraps it for the local stack with `.env.local`, a provisioned firm and an operator; `npm run db:migrate` brings one self-hosted database current. [docs/self-hosting.md](docs/self-hosting.md) is the operator-facing guide. Proven 2026-11-01: the replay matches the test instance's catalog, and every probe passes against it.
- pg_cron jobs are not part of the baseline (see [supabase/baseline-work/12_cron_review.md](supabase/baseline-work/12_cron_review.md)); scheduling is being consolidated into vercel.json.
- **Bulk writes to work tables**: `touch_matter_activity()` counts any real UPDATE to `dtr`, `files`, `deliverables`, `tasks`, `hearings`, `meetings`, `email_matter_links`, `matter_expenses`, the billing action and milestone rows, or `matter_action_entries` as matter activity, which restarts the 60-day auto-archive clock. A migration or script that rewrites those rows in bulk must start with `SET LOCAL lumilex.skip_activity = 'on';` (in its transaction), or every matter it touches looks freshly worked on — on the origin deployment one DTR backfill stamped 105 matters this way before the flag existed. Updates that change nothing (bookkeeping timestamps and the SharePoint mirror column aside) are already ignored (`20261017_matter_activity_skip_flag.sql`).
- **Connection budget**: a small-compute Supabase project allows 60 Postgres connections, and Supabase's own services (PostgREST, Storage via the pooler, Auth, Realtime) hold about 51 of them at idle — every firm instance starts on that budget. Every Storage request in flight takes a pooler connection, so a `Promise.all` over storage paths can exhaust the database: on the origin deployment, signing fan-outs on one page render caused bursts of `53300` refusals for PostgREST, Auth and pg_cron. Sign lists with `signStoragePaths` ([lib/storage-sign.ts](lib/storage-sign.ts)), one request per list, after the firm-prefix or visibility check that decides which paths may be signed — and batch or cap any other storage fan-out.

## API routes (`app/api/*/route.ts`)

Standard shape for any mutating handler:

```ts
const session = await getSession();
if (!session?.user?.notionUserId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const validation = await validateBody(req, mySchema); // from lib/validation
if (!validation.success) return validation.response;

const supabase = await getSupabaseServerAuthClient();  // RLS gates by user JWT
// ... do the work ...

logAudit({                                            // from lib/audit
  firmId: session.firmId,
  entityType: 'Deliverable',
  entityId: row.id,
  action: 'updated',
  performedBy: session.user.notionUserId,
  ipAddress: getClientIP(req),
});
```

- `getSession()` lives in [lib/session.ts](lib/session.ts) — a thin compat shim over Supabase Auth that returns the same shape NextAuth's `getServerSession` used to. Reads the Supabase Auth cookie via `@supabase/ssr`, looks up the `team` row by `auth_user_id`, returns `{ user: { notionUserId, role, name, email, image, nickname } }` or `null`.
- `session.user.notionUserId` is the legacy field name for the current user's `team.person_id` — keep using it; renaming would touch every route.
- `logAudit` is fire-and-forget by design — never `await` it, never let it block the response. `firmId` is required: `audit_log` is a tenant table, and the row is written through `getServiceDbForFirm`.
- **Default to `getSupabaseServerAuthClient()`** from [lib/supabase-server.ts](lib/supabase-server.ts) for handler DB ops — it carries the user's JWT and RLS is the active gate (see the per-table policies in `supabase/migrations/20260521_*` → `20260526_*`). The helpers `current_person_id()`, `current_role()`, `has_matter_access(matter_id)` etc. in the public schema codify the policy shape — read them when adding a new table.
- When service-role access is genuinely needed, reach for **`getServiceDbForFirm(firmId)`** from [lib/tenancy/service-db.ts](lib/tenancy/service-db.ts), not the raw client. It bypasses RLS the same way but pins every tenant-table query to one firm, stamps `firm_id` on inserts, and throws on a table it doesn't know. Legitimate reasons for service-role at all: cron / batch endpoints (CRON_SECRET-gated — see the cron rule below), AI artifact generation, and privileged writes the user's own JWT can't make. When a handler needs both, follow the dual-client pattern in [app/api/drafting/generations/[id]/download/route.ts](app/api/drafting/generations/[id]/download/route.ts): authed for the ownership check, firm-scoped service-role for the privileged write.
- **The raw `getSupabase()` is guarded.** `no-restricted-imports` in [eslint.config.mjs](eslint.config.mjs) blocks `@/lib/supabase` under `app/` and `lib/`, and `npx tsx scripts/audit-service-role.ts` fails CI on any tenant-table read through it. The permanent allowlist is grouped by reason — storage handles, `auth.admin`, global tables (`firms`, `firm_domains`, `ph_holidays`, `rule_sets`, `rule_deadlines`, `agents`, `drafting_idempotency`), the tenancy machinery itself, session bootstrap, and firm-resolution lookups. A **firm-resolution lookup** is the one pattern that reads a tenant table unscoped: a webhook or magic link arrives with no firmId, so the target row's own `firm_id` is read once and everything after it runs on the scoped client. Those must carry the marker comment `// firm-resolution lookup: scoped client follows`. Anything that fits none of those groups gets converted, not allowlisted.
- The browser-side auth-aware client lives at [lib/supabase-browser.ts](lib/supabase-browser.ts) (`getSupabaseBrowserAuthClient()`). Realtime subscriptions in `hooks/use-chat-*.ts` and `components/RecentFilesSection.tsx` use it; the legacy anon `supabaseClient` was retired in commit f778aa9.
- Unauthenticated endpoints are the exception, not the rule. The current ones are listed in [proxy.ts](proxy.ts)'s `matcher` exclusions (e.g. `api/sync`, `api/members`, cron endpoints gated by `CRON_SECRET`).

### Every handler establishes a caller

`npm run verify:route-auth` ([scripts/audit-route-auth.ts](scripts/audit-route-auth.ts))
checks all 472 exported handlers across 285 route files under `app/api`, per
**handler** rather than per file — a route can guard one method and not another.

- **proxy.ts excludes 21 prefixes from its matcher**, so a route under
  `api/admin`, `api/file-analysis` and the rest does its own check or has none
  at all. Both holes the sweep found were there: `/api/admin/claude-files`
  listed and deleted Claude Files content across every tenant with no session,
  and `/api/file-analysis/auto` took an arbitrary `fileId` and resolved it
  through the raw service-role client — the DB webhook had always sent
  `Authorization: Bearer <cron_secret>` and the route simply never looked.
- **Authentication is not authorization, and the gate only checks the first.**
  `/api/admin/file-upload` authenticated perfectly and still let any signed-in
  staff member delete any firm file, because it never checked a role. A green
  run is not a claim that a handler authorizes correctly — see the RBAC section
  on UI-only gating.
- **What counts as a guard is broad**: `getSession`, `getPortalSession`,
  `getOperatorSession` / `requireOperator`, `requirePortalSession`,
  `getAuthUserId`, or a `CRON_SECRET` bearer check. Adding `CRON_SECRET` to a
  handler puts it in `verify:cron`'s population, so a per-row webhook that is
  not a fan-out needs its reason in `ENTITY_SCOPED` there.
- **The allowlist is keyed `<route> <METHOD>`, not per file** — adding a POST to
  a route whose GET is unauthenticated by design fails until somebody says why.
  Five handlers are on it, all intentional and all documented at the call site.
- **A handler the scanner cannot read is a failure, not a pass.** If you hit
  that, teach the parser rather than allowlisting the route.
- **When a session and a bearer secret both authenticate a route, a
  caller-supplied `firmId` is ignored for the session branch** — trusting one
  would let firm A name firm B and reach the unscoped branch.

## RLS migration playbook

Hard-won lessons from the May 2026 RLS rollout (PRs 26–31 in the origin app + the hotfix chain `6d5e1e4` → `fc25257` → `0622c05`). Read this before doing another bulk handler swap or adding new policies.

### Current state (multi-tenant rework applied 2026-08-23, verified by `scripts/rls-probe.ts` + `get_advisors`)
RLS is rolled out AND firm-scoped. Every tenant table carries `firm_id uuid NOT NULL` (FK to `firms`); 181 policies carry a `firm_id = current_firm_id()` conjunct; `has_matter_access()` and `can_access_email()` are firm-bound, so role fall-throughs never cross firms. New helpers: `current_firm_id()` (staff via `team`, portal via `client_users`→`clients`) and `current_client_id()`.
- **`scripts/rls-probe.ts` is the gate**: it provisions two disposable probe firms with real auth users, exercises every persona through PostgREST, and must report all checks green. Run it after ANY policy or helper change. It also carries the two checks no static gate can make: the catalog-wide `firm_id` refusal sweep (below), and the invoice write path end to end — a whole billable bundle per firm, generated on a signed-in finance user's own client, because `persistInvoice` reaches `invoices` on the *authed* client from two of its callers and nothing else exercises that. Both firms bill the same month, so the per-firm invoice prefix and number counter are asserted against each other rather than against a constant.
- **`rls_disabled_in_public`: only `drafting_idempotency`** (internal idempotency scratch; service-role-only, intentionally off).
- **`rls_enabled_no_policy`: 29 tables** — deny-by-default (service-role only): `ai_usage_hourly`, `audit_log`, `demo_access_requests`, `backfill_state`, `calendar_feed_tokens`, `content_revisions`, `embeddings`, `file_analyses`, `generated_documents`, `matter_group_summaries`, `knowledge_searches`, `invoice_number_counters`, `client_code_counters`, `agent_runs`, `assistant_messages`, `assistant_announcements`, `assistant_digest_log`, `assistant_digest_settings`, `assistant_preferences`, `assistant_reminders`, `affidavit_reviews`, `affidavit_review_comments`, `chat_mutes`, `chat_push_tokens`, `firm_domains`, `firm_integrations`, `platform_operators`, `pleading_red_teams`, `pleading_red_team_comments`. Same rule as ever: swapping one of their handlers to the authed client requires adding policies first.
- **The firm_id column DEFAULTs are gone** (`20260823_drop_transitional_firm_defaults.sql`, 130 tables). `firm_id` stays NOT NULL, so an insert that omits it now raises 23502 instead of being silently filed under the dev firm. Every insert path — authed handlers, `logAudit`, cron fan-outs — stamps `firm_id` explicitly; `getServiceDbForFirm` does it for you. **Never re-add a default to make an insert work, fix the insert.** A re-added default is the one firm_id regression `verify:firm-id` structurally cannot see — that gate reads TypeScript, and a column default lives in the database — so `scripts/rls-probe.ts` checks it behaviourally on **every** table carrying `firm_id` (125 today, ~250ms), not one sample:
  - The sweep itself is `firm_id_insert_refusal_probe()` (`20260825_firm_id_insert_refusal_probe.sql`), enumerating from the catalog with the same predicate as `tenant_tables()`, so a table added tomorrow is covered tomorrow.
  - **The refusal has to be attributable.** Most tenant tables have other NOT NULL columns, so a bare insert is refused for whichever of them sorts first and proves nothing about `firm_id`. The function fills every other required column and omits only `firm_id`; NOT NULL is checked before CHECK, RLS `with_check` and FK triggers, so the one passing verdict is 23502 naming `firm_id`. `accepted`, `refused_other_column`, `refused_other` and `unsupported_column_type` are each reported as themselves and each fail.
  - **It leaves nothing behind.** Every attempt is its own plpgsql subtransaction and an insert that *succeeds* is rolled back immediately, so the failing case is as clean as the passing one. Identity and serial columns are pinned rather than defaulted — `nextval()` is non-transactional and would otherwise survive the rollback. Verified: zero rows and zero sequence drift per run.
  - The authed-client check on `tasks` stays alongside it: the sweep runs as service_role, and that one proves the refusal reaches a real caller through PostgREST.
- **The unstamped authed insert is the recurring live break, and `verify:firm-id` is the ratchet.** `getSupabaseServerAuthClient()` does *not* stamp `firm_id` the way `getServiceDbForFirm` does, so an authed-client insert into a tenant table that omits it 500s — 23502, or 42501 when RLS's `with_check` evaluates the NULL first. These are create flows, so it always presents as "the + Add button is broken". It shipped four times after the defaults dropped (`reconcileExpectedPairs`, the `notify_new_deliverable` trigger, `/api/admin/[entity]` POST, `createDeadlineChain`) before [scripts/audit-firm-id-stamping.ts](scripts/audit-firm-id-stamping.ts) closed it. The check resolves each write's *receiver* to its client — through scopes, the fan-out callbacks' `{ db }`, and function parameters back to every caller — so a shared `lib/` helper that is correct on its cron callers and wrong on one authed handler is caught, which is the shape four of the six remaining bugs took. Its allowlist is empty and should stay that way; an unresolvable site is reported rather than warned about.
- **A helper that writes a tenant table takes `firmId` and stamps it, even when today's caller passes a scoped client.** `applyInvoicePayment`, `applyDepositToInvoice`, `spawnComplianceDeliverables` and `createDeadlineChain` all read the client from a parameter, so whether the row needs an explicit `firm_id` is decided by a caller in another file. Stamping unconditionally is what makes the helper correct under both.
- **Stamp from the tenant registry when the table is computed.** `/api/admin/[entity]` and `/api/admin/batch-import` write `config.dbTable`, and one admin entity (`ph_holidays`) is a *global* table with no `firm_id` column — an unconditional stamp trades a 23502 on every other entity for a 42703 on that one. Ask `TENANT_TABLES.has(...)`.
- **`firmId` is a required parameter everywhere, and there is no fallback constant.** The dev-firm constant `FIRM1_ID` and its `lib/tenancy/constants.ts` are deleted; every helper that touches a tenant table — `createNotificationsBatch`, `notifyAttendeesAddedTo{Meeting,Hearing}`, `generateClientUploadNotifications`, the seven `lib/calendar-sync.ts` exports, the four `lib/status-report-auto.ts` exports, `loadFeeSchedules`, `createDeadlineChain` / `deleteDeadlineChain` — takes it as a required argument. A default parameter is worse than a missing column default: the insert succeeds under the wrong firm instead of raising 23502. Callers get it from `session.firmId`, `firm.id` inside a `forEachActiveFirm` fan-out, `ctx.member.firmId` on assistant paths, or the row's own `firm_id` in a backfill script. If a new call site has no firm in scope, that is a design gap to resolve upstream — never a reason to reintroduce a constant.
- **Views are a way in, and the probe holds every one of them.** This section used to file `security_definer_view` on `filings` and `v_deliverable_version_lookup` under "hardening, not access holes". That was wrong. Both views ran as `postgres` (BYPASSRLS), skipping every policy on `deliverables` / `deliverable_files`, and both carried Supabase's default ALL grant to `anon`. `filings` is a simple single-table view, so Postgres made it auto-updatable. With the public anon key, `GET /rest/v1/filings` listed every firm's external deliverables, and `PATCH`/`DELETE` wrote through to them. `20260925_views_security_invoker.sql` fixed it (the `filings` view has since been dropped):
  - **`security_invoker = on`**: a view can never show more than its base tables' RLS would.
  - **SELECT-only grants, nothing for anon**: a write grant on a view is a second door into a table whose policies were written for the first.
  - **A trailing `firm_id` on each view**: the service-role facade scopes view reads through `TENANT_VIEWS` and throws on any write through one. Before this it passed views through unscoped, so `getFilingById(id, firmId)` and the `/api/chat/entities` name search returned other firms' rows.

  `view_exposure()` (`20260925_view_exposure_rpc.sql`) reports every public view's shape. `scripts/rls-probe.ts` fails on a view that is not invoker, grants anon anything, grants authenticated a write, lacks `firm_id`, or is missing from `TENANT_VIEWS`. The registry generator builds `TENANT_VIEWS` from the same RPC and refuses a view without `firm_id`. A new view therefore needs `with (security_invoker = on)`, a revoke from anon, SELECT-only grants and a `firm_id` column, in the migration that creates it.
- Re-run `mcp__supabase__get_advisors(type: 'security')` after DDL changes. As of 2026-09-26 there are 64 findings:
  - 15× `function_search_path_mutable` on pre-rework trigger and search functions.
  - 7× `anon_security_definer_function_executable` and 11× `authenticated_security_definer_function_executable`. The `current_*` / `has_matter_access` / `can_access_email` helpers return NULL or false without the right JWT; `allocate_invoice_number` and `allocate_client_code` take a `p_firm_id` and raise `caller not authorized for firm` when it isn't the caller's.
  - **SECURITY DEFINER trigger functions carry no EXECUTE grant to any API role.** EXECUTE on a trigger function is checked at `CREATE TRIGGER`, never when it fires, so the grant does nothing but put the function on both lists above. `20260926_revoke_trigger_function_execute.sql` revoked it from the ten that had it (proved first in a rolled-back block: every trigger still fired for an authed staff write, and for service_role on `chat_messages` / `file_analyses`), plus `recalc_client_status(text)` — a cross-firm write anon could reach through `/rest/v1/rpc` whose only caller is its matters trigger. `20260926_revoke_call_app_api.sql` did the same for `webhook_file_uploaded`. A new SECURITY DEFINER trigger function gets the same `REVOKE ... FROM PUBLIC, anon, authenticated, service_role` in its migration.
  - **This list once filed two ways in as hardening.** The views above were one; `call_app_api` / `call_app_api_post` were the other. They send `Bearer <cron_secret>` to `app_base_url || path`, and they were anon-executable: the anon key alone reached every CRON_SECRET route with any `firmId`, and a path of `@attacker.example/` sent the secret to another host. `20260926_revoke_call_app_api.sql` revoked EXECUTE from every API role (only triggers call them) and made them reject any path that is not a plain `/…`. `scripts/rls-probe.ts` asserts the 42501 for anon, staff and portal users, and checks that the file-upload trigger still fires. **When sorting these findings, read what the function does, not just its name.** Anything that reads Vault or calls `net.*` is a credential, not a helper.
  - 26× `rls_enabled_no_policy` and 1× `rls_disabled_in_public`, as listed above.
  - 3× `extension_in_public` (`pg_trgm`, `btree_gist`, `citext`), leaked-password-protection off.
- **The advisors do not look at `storage.objects`.** Every finding above is `public.*` or an auth setting; a bucket policy that grants `authenticated` blanket access to a whole bucket — which is what `documents` and `receipts` carried until `20260823_storage_drop_blanket_authenticated_policies.sql` — produces no advisor finding at all. `scripts/storage-probe.ts` is the gate for that half.

### Crons must stay service-role
- **Any handler whose auth check is `process.env.CRON_SECRET` (with or without a fallback session) cannot use the authed client.** The cron path has no JWT, so `current_person_id()` is NULL, `team_authenticated_select` returns 0 rows, and every team-scoped read returns empty. The handler doesn't 500 — it silently does nothing and reports `sent: 0`, which looks like a normal idle day. Two crons (`email-briefer`, `sharepoint-backfill`) silently broke for hours this way.
- Rule: if the file has `process.env.CRON_SECRET` anywhere, the whole handler is service-role. Don't try to dual-client based on which auth path matched — the cron will hit the wrong branch.
- Crons today: `notifications/email-briefer`, `notifications/generate`, `matter-summary/{route,batch,refresh-stale}`, `admin/sharepoint-{backfill,sync}`, `admin/{migrate,rehost}-files`, `deliverable-analyze`, `deliverable-file/backfill`, `embeddings/generate`, `file-analysis/backfill`, `admin/test-sp-upload`, `cron/subject-status`, `cron/corporate-obligations`. Don't migrate any of these to the authed client.

### SELECT policy ≠ team can use the table
- An RLS policy with `polcmd = 'r'` covers only `SELECT`. INSERT, UPDATE, DELETE each need their own policy (or a `FOR ALL` policy). If you swap a handler to the authed client and the table only has a read policy, every write 500s with `42501: new row violates row-level security policy`. Tables that bit us: `files`, `chat_channels`, `chat_messages`, `matter_summaries`, `matter_exec_summaries`.
- Quick check before any swap:

```sql
SELECT polcmd, polname FROM pg_policy WHERE polrelid::regclass::text = 'YOUR_TABLE';
```

- `polcmd` letters: `r`=SELECT, `a`=INSERT, `w`=UPDATE, `d`=DELETE, `*`=ALL.

### Verification has to include writes, not just SELECT counts
- The PR 5 SQL probe only counted rows per role. INSERT bugs hide from that — the row count is the same regardless of whether an INSERT would succeed.
- When adding or changing policies on a table that gets written, simulate a write under a JWT:

```sql
BEGIN;
SET LOCAL request.jwt.claims TO '{"sub":"<auth_user_id>","role":"authenticated"}';
SET LOCAL role authenticated;
INSERT INTO public.<table> (...) VALUES (...);  -- expect success
-- and for negative-case verification:
INSERT INTO public.<table> (...) VALUES (...);  -- expect 42501
ROLLBACK;
```

Pick one lawyer (own-row case) + one user who shouldn't have access (deny case). Run both.

### Bulk swaps need a write-path audit before merging
- The PR 5 `sed`-based bulk swap converted ~60 handlers in one go. The audit was per-role SELECT counts; it missed 8 write regressions. A static check would have caught most:

```bash
# Handlers on the authed client that write to SELECT-only tables
python3 <<'PY'
import re, subprocess, pathlib
authed = subprocess.check_output(['grep','-rl','getSupabaseServerAuthClient','app/api/'],text=True).splitlines()
ops = re.compile(r"\.from\(['\"](\w+)['\"]\)\s*\.\s*(insert|update|upsert|delete)", re.I)
for f in authed:
    for m in ops.finditer(pathlib.Path(f).read_text()):
        print(f, m.group(1), m.group(2).lower())
PY
```

  Cross-reference against `pg_policy` for each `(table, op)` tuple.

### When a write legitimately needs service-role, use the dual-client pattern
- Storage uploads, cross-tenant lookups for display, `logAudit`, and any cron path are legitimate reasons to keep `getSupabase()`. When a handler needs both — authed for the ownership check, service-role for the privileged write — follow the template in [app/api/drafting/generations/[id]/download/route.ts](app/api/drafting/generations/[id]/download/route.ts):

```ts
const authed = await getSupabaseServerAuthClient();
const { data: matter } = await authed.from('matters').select('notion_id').eq('notion_id', id).maybeSingle();
if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

const service = getSupabase();
// storage upload / cross-tenant insert / etc.
```

  RLS is the gate (the authed read returns null if the user doesn't own the row → 404). Service-role only runs after the authorization decision.

### `team` is guarded by column, not just by row
- **Self-service edits are limited by a trigger.** `team_self_update` admits a person to their own row, and RLS cannot name columns, so `team_guard_self_update` refuses (42501) any self-service change but `nickname`; admin, super_user and the service role pass. A new profile field people edit themselves goes in its `self_editable` list, or the edit 500s.
- **`monthly_salary` is withheld from `anon` and `authenticated`** (`20261017_team_salary_column.sql`): the table grant was replaced by a grant on every other column. Read and write salary through `getServiceDbForFirm` after a finance / partner / super_user check. Two consequences: `select('*')` on `team` through a JWT is refused outright, so name the columns; and **a column added to `team` is unreadable through a JWT until it is granted** — re-run that migration's grant in the migration that adds it. `scripts/rls-probe.ts` fails until you do.

### The client portal reads nothing with the client's JWT
- A signed-in client holds a JWT and the anon key, so anything an RLS policy lets them read, they can read whole through PostgREST — every column, every row the policy admits. The old `*_portal_select` policies scoped by firm and client only, and exposed drafts and internal deliverables, internal meetings, invoice line items, exhibit notes and the working copies of unfinished work in `files`. `20261029_portal_close_direct_reads.sql` dropped them, and `files_portal_insert` with them.
- So portal pages and `/api/portal/*` read with `getServiceDbForFirm(session.firmId)` after `getPortalSession()` / `requirePortalSession()`, and every query scopes to `session.user.clientId` itself — the `lib/portal/data.ts` loaders do, and the staff preview calls the same loaders. A client's JWT reads only its own `client_users` row and its own `portal_chat_messages`. Portal writes run on the scoped service client too, after the ownership read.
- **What a client may see of the work is one rule**, in [lib/portal/deliverable-visibility.ts](lib/portal/deliverable-visibility.ts): no `Internal` deliverable, nothing unfinished, only the `deliverable_files` row tagged "Filed version", and a `files` row tied to a deliverable only when that deliverable is shown. The matter page, the chat context and the download / sign / zip allowlists (`loadPortalVisiblePaths`, `loadPortalVisibleFileRows`) all ask it, so a path is openable exactly when the page lists it.
- Never add a policy that admits a client user to a firm table; a new portal read is a scoped service query in `lib/portal/`. `scripts/rls-probe.ts` asserts a client's JWT reads nothing from the firm tables behind the portal, with its own rows as the signed-in control.

### Tables that are intentionally write-incomplete
- `notifications` — no team INSERT policy (the cron writes via service-role).
- `team` — no team INSERT/DELETE policy (admin creates new team members via `supabase.auth.admin`).
- `client_users` — all writes via service-role admin flows in `/api/clients/[id]/users`.
- `leaves` — only the deciding roles (partner, admin, super_user) may UPDATE (`leaves_decider_update`). The applicant's own-row update policy was dropped because it let anyone PATCH their leave to `Approved` through PostgREST; nothing in the app edits a leave as its applicant. If applicants get to cancel or revise, give them a route that fixes which columns change — not a wider policy.
- `matter_summaries` and `matter_exec_summaries` have **no portal policy**. Both are written for the firm's lawyers (the brief is built from tasks and pending drafts), and the portal must never show them or feed them to its chat. `scripts/rls-probe.ts` asserts a portal client reads neither.

  These are deliberate. Don't add policies to "complete" them without thinking through who actually writes.

## Auth specifics

- Auth provider is **Supabase Auth** (email + password, `signInWithPassword`). NextAuth was retired in the 2026-05-19 migration.
- **Two checks, on purpose.** [proxy.ts](proxy.ts) verifies the session with `getClaims()`: with asymmetric (ES256) signing keys it checks the signature locally against the cached JWKS with no GoTrue round trip, and it still refreshes an expiring token and writes the cookies. `getSession()` (and `getPortalSession()` / `getOperatorSession()` through `getAuthUserId()`) calls `getUser()`, which asks GoTrue and is the authoritative check, so a revoked session is refused by every page and route that calls one of them even though it can pass the proxy until its token expires. The proxy's team, client_users and platform_operators reads still filter on `active`, so deactivating someone bites there at once. Keep that split: `getUser()` in the proxy doubles the Auth load of every request, and `getClaims()` in the session helpers would let a revoked session act until its token expires. A firm instance still on the legacy HS256 secret gets no saving — `getClaims()` falls back to asking GoTrue — so move each project to asymmetric signing keys.
- Identity bridge: `team.auth_user_id uuid → auth.users(id)`. The 2 team rows without a password (and thus without an `auth.users` row) can be bootstrapped via the set-password admin flow — see [app/api/auth/set-password/route.ts](app/api/auth/set-password/route.ts).
- When manually inserting into `auth.users` via SQL (e.g. in a migration), the Auth Go service can't scan NULL into the token string columns. Always set `confirmation_token`, `recovery_token`, `email_change_token_new`, and `email_change` to `''`, not NULL. Otherwise sign-in returns 500 "Database error querying schema".
- The legacy `user_passwords` backup table is dropped in the schema baseline; it no longer exists.
- Manual Supabase dashboard tasks (SMTP, sign-up toggle, refresh token lifetime, email templates) are tracked in [docs/auth-migration-followups.md](docs/auth-migration-followups.md).

## RBAC

- Role lives on `team.role`. Values in use: `lawyer`, `partner`, `admin`, `finance`, `super_user`, `chief_liaison_officer`, `liaison_officer`.
- **Who may open which page is one map**, `ROUTE_ACCESS` in [lib/nav/access.ts](lib/nav/access.ts) (whole-segment prefixes, longest wins, `rewrite` for a role whose copy of a page lives in another shell, `homeFor(role)` for everyone's landing page). [proxy.ts](proxy.ts), the area layouts and page guards (`requireRouteAccess` / `requireAreaAccess` in [lib/nav/guard.ts](lib/nav/guard.ts)) and the sidebars (`pagesForRole`) all read it, so a new page or a role change goes there, never into an inline `role !==` redirect. `lib/nav/access.test.ts` replays the map over every page for every role against the table of what each role could open before the map, and fails on anything it would newly open; `lib/nav/routes.test.ts` fails on an inline role gate. A firm's features close pages on top of the map — each page's own `isFeatureAvailable` check, and `visiblePages` for every link — never open them. Don't rely on UI-only gating.
- **Setup pages are reached through the settings hubs**, Firm settings (`/admin/settings`) and Finance settings (`/finance/settings`), listed in [lib/nav/hubs.ts](lib/nav/hubs.ts) and shown through the same map, registry roles and features (`hubFor`). The pages are More-only in their registry; a new setup page gets a hub entry, and `lib/nav/hubs.test.ts` fails on a More-only setup page no hub lists. Instance configuration (branding, features, credentials, domains) stays on `/platform`, never in a hub.
- **A person's own sidebar** (`user_preferences.sidebar_layout`, per area) is merged in [lib/nav/custom-sidebar.ts](lib/nav/custom-sidebar.ts): `customSidebar` resolves pins against `visiblePages` — the route map and the firm's features — so saved choices never widen access or show a feature the firm lacks, and its `moreCounts` hands a hidden link's count to More.
- `super_user` is a developer escape hatch and should pass every **role** check.
- It does **not** pass **identity** checks. `isManagingPartner()` ([lib/auth/isManagingPartner.ts](lib/auth/isManagingPartner.ts)) and `canClearBundle()`'s relationship-partner test ([lib/auth/relationship-partner.ts](lib/auth/relationship-partner.ts)) ask "is this specific person X?", not "does this person have enough privilege?". Those decisions carry a name into the record — a bundle approval, a salary — so a stand-in would attribute them to the wrong human. A caller that genuinely needs a super_user override adds it explicitly at the call site.

## Notion is gone

- Supabase is the sole source of truth. `lib/notion.ts`, `lib/sync/`, `/api/sync`, and every Notion write-back were deleted in the Lumilex fork — do not reintroduce any Notion dependency.
- The `notion_id` PRIMARY KEY columns and `session.user.notionUserId` naming survive as legacy identifiers only. New rows mint ids with `mintId(entity)` from [lib/ids.ts](lib/ids.ts) (`<entity>-<uuid>`); older rows hold Notion page UUIDs or `temp-<entity>-<timestamp>` strings.

## The Library and Search

**The Library is one table, `kb_pages`, holding three kinds of page** — the
firm handbook (guides, policies, references, announcements; HTML from the
rich-text editor), the pages distilled from matters (Markdown with
citations), and the Rules of Court (HTML, one page per rule, imported). The
vocabulary and every permission rule live in
[lib/library/model.ts](lib/library/model.ts), pure and tested; the API
(`/api/library/pages`) and the UI both ask it rather than re-deriving who may
edit, publish, delete or restore what. `resources` was merged in by
`20260928_library_merge.sql` and survives as `resources_legacy_20260928` with
its API grants revoked — drop it once nothing has needed it for a while.

- **Handbook HTML is rendered with `dangerouslySetInnerHTML` and lawyers write
  it, so it is sanitized on write, on restore and on load** —
  `sanitizeHandbookHtml` from [lib/sanitize-html.ts](lib/sanitize-html.ts),
  whose core the comment sanitizer shares. Any new path that stores or renders
  a handbook page goes through it. The sanitizer decodes entities before it
  reads a URL; checking the raw value is how `javascript&#58;` got past the
  comment sanitizer it replaced.
- **Every edit of a Library page or fee schedule leaves a snapshot** in
  `content_revisions` ([lib/content-revisions.ts](lib/content-revisions.ts)),
  taken after the write lands so history never claims an edit RLS refused.
  The table is deny-by-default; `/api/content-revisions` shows a page's
  history only to someone whose own RLS returns the page, because a
  partner-only page's old versions are as partner-only as the page.
- **Distilled pages follow the firm's `ai_search` switch**
  ([lib/library/scope.ts](lib/library/scope.ts)) — they are AI output, as the
  old Knowledge Base page was. The handbook and the Rules of Court do not.
- **The Rules of Court and the codes are per firm** (`court_rule_sections`;
  `legal_codes`, `code_provisions`, `code_provision_versions`,
  `code_provision_reviews` — all tenant tables): the text is public, but each
  section or code points at its page in one firm's Library, and a review is
  one firm's sign-off. The code tables' children reach their parent through a
  composite `(firm_id, …)` foreign key, so a row cannot hang off another
  firm's code or provision. `scripts/import-rules-of-court.ts <firm>` and
  `scripts/import-legal-codes.ts <firm>` load them, idempotently;
  provisioning does not, so a new firm needs both run once. They are
  read-only for every role — the law changes by re-import, never by hand.
- **The law is read whole, one Library page per code or per book of the
  Rules** (`kb_pages.kind` `legal_code` / `rules_of_court`). The page's
  `content_md` is only a preface; the Library renders the text from the
  provision rows through `loadStatute` ([lib/library/statute.ts](lib/library/statute.ts))
  and [StatuteReader](components/library/StatuteReader.tsx). Link to a
  provision with `provisionHref(code, number)` or the Rules' `sectionHref`
  ([lib/codes/model.ts](lib/codes/model.ts), [lib/rules/model.ts](lib/rules/model.ts));
  both redirect to the page at the provision's anchor.
- **Every provision keeps its history** in `code_provision_versions`
  (original, then each amendment, insertion, renumbering or repeal, with the
  law and section that made it). An earlier version's text may be unknown,
  and is null then — never fill it from memory. `code_provision_reviews` is
  the append-only record that a reviewer (partner, admin, super_user) checked
  a version against its source; `POST /api/codes/provisions/[id]/review`
  checks the role before RLS does.
- **Code text comes from the signed copy or an official consolidated
  edition, never from lawphil's HTML alone** (the RCC there has dozens of
  typos and dropped lines against the signed law). `data/codes/<code>.json`
  is the parsed result and is committed; `scripts/parse-legal-code.ts` makes
  it, and a re-parse is checked word for word against the committed file
  before it is imported.

**Search runs a keyword pass beside the semantic one**
([lib/ai/knowledge-search.ts](lib/ai/knowledge-search.ts)): full text over
`file_analyses.extracted_text` and the Rules of Court, and names of files,
deliverables and matters, merged in front as "Exact matches".

- **The two search RPCs take `p_firm_id` first, with no default, and no API
  role may execute them** (`search_document_text`, `search_court_rules`).
  `.rpc()` passes through `getServiceDbForFirm` untouched, so the filter inside
  the function is the only thing keeping one firm's text out of another's
  results. `scripts/rls-probe.ts` asserts both ways for both.
- **Every result is narrowed to what the viewer could open**
  ([lib/ai/knowledge-access.ts](lib/ai/knowledge-access.ts)): matter-scoped
  sources need the matter, a Library page needs the viewer's own RLS to return
  it *and* to be published, and only incoming files and the Rules of Court are
  firm-wide. A new source type is matter-scoped until someone says otherwise.
- **A PostgREST `or()` value cannot carry its own delimiters.** The matter
  name match and the Library list both strip `,()` and quotes from the query
  before building one; a raw query there rewrites the filter.
- **Keyword search needs the text.** Incoming PDFs are analysed through the
  Files API, which stores none, so
  [lib/ai/document-text.ts](lib/ai/document-text.ts) fills `extracted_text`
  after each analysis — the local parser first, Claude transcribing a scan
  under the firm's `ai_analysis` only when the parser finds no text layer.
  `scripts/backfill-file-text.ts <firm>` does the archive.

## AI artifacts (matter briefs, exec summaries, file analyses)

- Stored in dedicated tables (`matter_briefs`, `matter_exec_summaries`, `matter_summaries`, `file_analyses`) with a `needs_refresh` flag.
- Triggers set `needs_refresh = true` when source data changes; a Vercel nightly cron (`/api/matter-summary/refresh-stale`) regenerates flagged rows.
- When you mutate something an AI artifact depends on (e.g. a deliverable file), check whether the triggers already flag `needs_refresh` for you before adding application-level logic.
- Generation helpers live in [lib/ai/](lib/ai/). Embeddings are Voyage AI; LLM calls are Anthropic Claude via `@anthropic-ai/sdk` — but never constructed directly. See the gate below.

## The AI gate — every model call names a firm and a feature

AI is **opt-in per firm and per surface**. A firm that has not opted in is
refused by a function that will not run, not by a prompt instruction or a UI
check — the same rule as `lib/agents/` and `lib/tenancy/service-db.ts`.

**[lib/ai/gate.ts](lib/ai/gate.ts) is the only place a model client is
constructed.** Before it there was no chokepoint: 22 files each built their own
`new Anthropic({ apiKey })`, so "ask before sending this firm's content
somewhere" was a convention — the same shape as `firm_id` stamping before
`getServiceDbForFirm`, which shipped broken four times.

- **`anthropicFor({ firmId, feature })`** resolves the feature and throws
  `FeatureDisabledError` when the firm has not opted in. **`firmId` is required
  and has no default** — a default repeats the `firm_id` column mistake, where
  the call succeeds under the wrong firm instead of refusing. The context is one
  object rather than two positional strings because it threads through long
  chains (`auto-analyze` → `claude` → the SDK) where a transposed pair is
  silent.
- **A firm may carry a ceiling on model calls**, `firms.settings.aiLimits`
  (`{ perHour, perDay }`, the day in Manila). `anthropicFor` spends one call
  against it through the `consume_ai_call` RPC (ledger: `ai_usage_hourly`)
  and refuses past it with `FeatureDisabledError` reason `allowance_spent`,
  which `aiRefusalResponse` turns into a 429. Null — every real firm today —
  writes nothing. It lives in the gate because the gate is the one place every
  client is built, crons included; a ceiling at the routes would miss those.
- **`requireAi(ctx)`** asserts without building a client — for the Voyage paths
  (`lib/ai/voyage.ts` is a plain `fetch`) and for refusing before assembling a
  prompt. **`refuseIfDisabled(firmId, feature)`** is its route-boundary form,
  returning a 403 or null; **`aiRefusalResponse(err)`** converts a throw that
  surfaced from deeper. Use one of them at every AI route: since AI is off until
  a firm turns it on, the refusal is the *normal* answer for most firms and must
  not arrive as an unhandled 500.
- **`anthropicForPlatform(reason)`** is for work with genuinely no firm behind
  it, against a **closed union** of reasons — `issuances_extraction` (public
  government material, scraped once and fanned out) and
  `claude_files_maintenance` (the Files API store is keyed by
  `ANTHROPIC_API_KEY`). It is not a bypass: it exists so "no client outside the
  gate" stays literally true and the exceptions stay countable. If the content
  belongs to a firm, this is the wrong function.
- **Voyage is gated in [lib/ai/embeddings.ts](lib/ai/embeddings.ts)**, the only
  module allowed to call it. The **read** path is gated *before* `embedQuery` —
  the query string is itself firm content — and returns `[]` rather than
  throwing, because a firm without the feature has no vectors either and a
  background retrieval must not 500. The **write** path throws: that is where
  content becomes a stored copy at a second subprocessor, and a silent skip
  there looks exactly like an idle backfill.
- **`ANTHROPIC_API_KEY` is optional at boot** ([lib/env.ts](lib/env.ts)), like every other integration key: a self-hosted instance may run with no AI, and each AI feature — `issuances` and `drafting` included, which need Claude besides Firecrawl and Voyage — reports `platform_unconfigured` through `isAnthropicConfigured()` rather than failing.
- **`isAnthropicConfigured()` lives alone in
  [lib/ai/anthropic-config.ts](lib/ai/anthropic-config.ts)** and must stay
  there. `features.ts` needs it to answer level 1 for the AI keys, and
  `claude.ts` needs `features.ts` through the gate to construct a client — same
  leaf-module split as `isVoyageConfigured`.

**The keys are four consents, not one.** `ai_analysis` (Claude reads stored
matter and client documents), `ai_search` (Voyage embeds firm content into
durable stored vectors — a different subprocessor and a derived copy, not a
one-shot read), `ai_assistant` (the staff assistant, which holds write tools),
`ai_client_chat` (AI answering the firm's *clients*). Enabling `portal` is not
consent for a model to answer your clients. `drafting`, `red_team` and
`issuances` predate this group and keep their own keys, so a firm's answer stays
per surface. `AI_FEATURE_KEYS` collects all seven — `issuances` is in it despite
disclosing nothing (its input is public government material) because it still
constructs a client, and the ratchet only holds if *every* client goes through
the gate.

**`npm run verify:ai-gate`** ([scripts/audit-ai-gate.ts](scripts/audit-ai-gate.ts))
is the ratchet. Deliberately syntactic and dumb — it greps for the SDK
constructor and the Voyage entry points, so it cannot be argued with and a new
call site fails until somebody routes it through the gate. The allowlist is
grouped by reason: `embeddings.ts` (it holds the `ai_search` check) plus six
operator-run maintenance scripts, which take an explicit firm argument and have
no session to consent on anyone's behalf.

**New AI keys are registered disabled.** `20260901_ai_feature_keys.sql` adds the
four for every firm with `on conflict do nothing`, so a re-run never un-does an
operator's decision; new firms get them from `ensureIntegrations` iterating
`FEATURE_KEYS`. Gate the UI by suppression as usual — the four AI pages redirect
server-side and their nav entries are feature-gated, because nav suppression is
not a gate.

## Subjects and matters

- **A matter is an engagement** (client, fee terms, team, time, invoices). **A subject is a thing the firm looks after** — a company, a mark, later a visa, permit, patent or case — with its own identity and lifecycle. `subjects` holds what every type shares; each type keeps a detail table on the same id (`corporations.id`, `trademarks.id`), and triggers keep `subjects.name/status/identifier` current from it.
- **`matter_subjects` says which engagement covers a subject, in what scope** (`incorporation`, `post_incorporation`, `housekeeping`, `retainer`, `trademark`). One retainer can cover several companies. Billing never moves to subjects; matter groups still model an umbrella engagement with separately priced sub-engagements.
- **Corporations read their matters only from the links.** Query them with `CORPORATION_SELECT` ([lib/corporations/matter-links.ts](lib/corporations/matter-links.ts)); `rowToCorporation` throws on a row without the embed, and `matter-links.test.ts` fails the build on a `select('*')` that feeds it. Write links with `setMatterLink`. The `handles_*` flags are not derived from links — they record the agreed scope, which a retainer can cover with no matter of its own.
- **Marks have a stored status too** (`buildTrademarkStatus`, [lib/trademarks/status.ts](lib/trademarks/status.ts); refreshed with the companies): the Trademarks list and the deadline dashboard read it. A mark's deadlines come from one list, `pendingDeadlines` in [lib/trademark-deadlines.ts](lib/trademark-deadlines.ts).
- **Marks read their matters from the links too**, each in a role (`trademark` filing, `trademark_maintenance` DAU & renewal, `opposition`, `retainer` — [lib/trademarks/matter-links.ts](lib/trademarks/matter-links.ts)); write them with `PUT /api/trademark/[id]/matters`. A mark's **client is its own field** (`trademarks.client_id`); `trg_trademarks_client_fields` keeps its name, code and Ref.-No. index right whenever it changes, by any path. Until the contract migration, `trademarks.matter_id`/`matter_name` mirror the mark's main link (filing, else retainer) for the readers that show one matter, and a write to `matter_id` still sets the filing link (`trg_trademarks_mirror_matter`, which skips the reverse mirror's own writes).
- **Work items name their subject** with `deliverables.subject_id` (and the optional `dtr.subject_id`). A compliance filing belongs to a company when it names it, or names none and sits on one of its matters — never just because it is on a shared matter.
- **Client reports share one engine** ([lib/client-reports/](lib/client-reports/), [components/client-reports/ClientReportModal.tsx](components/client-reports/ClientReportModal.tsx)): the letter's frame on the firm's own letterhead, the annex sentences, the email with the firm's own name and address, the PDF where the firm has `docx_pdf` (else the Word file), and the attachments read through the firm's scoped client. There is no signing: a report goes unsigned, with the sender's printed name. Each kind brings only its events, caption and wording — marks in `lib/trademarks/client-report.ts` (sent from the firm's `settings.email.ipAddress`), companies in [lib/corporations/client-report.ts](lib/corporations/client-report.ts) (sent from `settings.email.complianceAddress`, edited on `/platform`: registrations, filed compliance items, meetings held, signed resolutions; logged in `corporation_client_reports`). A company's report names its next deadlines from its open compliance items; never type a date into its wording. Company wording isn't editable in Settings yet.
- **A company's registrations are tasks, not deliverables** (`tasks.subject_id` + `tasks.corporation_step`, [lib/corporations/step-tasks.ts](lib/corporations/step-tasks.ts)): an agency registration has nothing to draft or review, like the business permit ([lib/corporations/permit-task.ts](lib/corporations/permit-task.ts), whose tasks carry the same columns). Recording the registration on the company closes its open task (`trg_corporation_steps_close_tasks`); finishing the task does not record the registration, which the agency grants. A deliverable on a company is written work, started through the general New Deliverable form with its `subject`, on a matter that covers the company.
- A new practice adds a `subjects.type`, a detail table, and an obligations catalog — not new matter columns.
- **Cases are disputes as subjects** (`cases`, `case_proceedings` as a tree of forums, `case_proceeding_matters`, `case_links`; `20261121_cases.sql`). A case is covered by several matters at once (scope `case`); every other scope stays one matter per subject through the partial index `matter_subjects_one_per_scope`, so write links with `setMatterLink` → `set_matter_link(p_firm_id, …)`, which refuses a subject of another firm, never with a PostgREST upsert. The case's title follows its furthest proceeding unless pinned. `scripts/cases-backfill.ts <firm>` plans a firm's cases from its matters' case fields, writing the plan and its SQL outside the repo; the merges a person confirms go in its `--config` file, never in code.
- **People are one record per human, per firm** (`people`, a `subjects` type `person`); `corporation_roles` says what they are in a company (director, president, stockholder with shares). `corporation_persons` is a **read-only** view joining the two in the old shape (invoker, SELECT only, trailing `firm_id`), so readers keep working. Writes go through three invoker functions (`20261121_people.sql`), never through the view: `corporation_person_insert(p_row)` joins the person of the same name in that company, or of the same name and TIN/passport in the firm, or the `person_id` it names; `corporation_person_update(p_id, p_patch)` edits the person on a detail edit, and on a rename joins the person the new name belongs to, splits off only if the old record still holds other roles, and otherwise renames in place; `corporation_person_delete(p_id)` deletes a person left with no role. They run as the caller, so RLS on `people` and `corporation_roles` is the gate, and a person is never matched across firms. Group roles by `personRecordId` (`groupPeople` in [lib/corporation-identity.ts](lib/corporation-identity.ts)), never by name. `CorporationFile.personId` is a **role** id. To rename a person rather than one of their roles, update `people` (`PATCH /api/corporation/[id]/people/by-person/[personRecordId]`).
- **Lists that span the book read the stored status, never the raw records.** `subject_status` / `subject_status_items` hold each company's `buildCorporationStatus` reading; triggers mark a subject stale when anything it reads changes, and `/api/cron/subject-status` recomputes stale or earlier-dated rows in batches of 100, per firm through `forEachActiveFirm` ([lib/corporations/status-refresh.ts](lib/corporations/status-refresh.ts)). A company's own page computes live. When the status starts reading a new table, add a stale trigger for it in the same migration, or the list silently lags. `npx tsx scripts/subject-status.ts <firm>` refreshes by hand. The filing calendar (`compliance_calendar`) is per firm too: a change to it marks only that firm's companies stale.
- **The client portal shows a company or mark only when the team switches it on** (`corporations.portal_visible`, `trademarks.portal_visible`, off by default) and one of the client's matters covers it. `portalScope` ([lib/portal/companies.ts](lib/portal/companies.ts)) is that rule, and it is applied in TypeScript, on the firm-scoped service client, scoped to `session.user.clientId` — the same as every other portal read (see "The client portal reads nothing with the client's JWT"). There is no portal policy on `subject_status`, `subject_status_items`, `matter_subjects` or `corporation_files`, and none may be added. The portal pages and the staff preview call the same loaders. The portal reads the stored status, never `corporations`, `trademarks` or people, so no TIN, ID, address, note or billing instruction can reach it; a mark's few display columns and image are read only for marks `portalScope` has admitted ([lib/portal/trademarks.ts](lib/portal/trademarks.ts)). Documents appear only when `client_visible` (never a person's file), and `loadPortalVisiblePaths` adds exactly those to the portal's download allowlist. **A client is never told something is late:** `forClient` ([lib/portal/companies.ts](lib/portal/companies.ts)) shows a past-due item as in progress, without its past date, first among what is ahead, and the overdue state never leaves the server. Other client-facing words go through [lib/portal/company-wording.ts](lib/portal/company-wording.ts); no team summaries.
- **Plan for thousands of subjects.** PostgREST returns at most 1,000 rows and says nothing — read lists with `fetchAllRows` ([lib/supabase-paginate.ts](lib/supabase-paginate.ts)) or page in SQL; keep `in (...)` filters to batches of ~100 ids, and write in bulk, not one row per round trip.

## Agents

An *agent* is software that decides something on its own initiative, as opposed to the AI artifacts above (which only render text on demand) and the API routes (which do what a person just asked). Agents are registered, ledgered, and capped — three rules, all enforced in [lib/agents/](lib/agents/) rather than in a system prompt.

**Every agent is registered.** A row in `agents` with an `autonomy` tier: `read_only`, `propose`, or `disabled` (the kill switch). An agent id that isn't in the table is treated as disabled, never as unrestricted. Add the id to `AGENT_IDS` in [lib/agents/registry.ts](lib/agents/registry.ts) and seed the row in the same migration.

**Every wake-up is ledgered.** Wrap the entry point in `withAgentRun(agentId, { trigger, triggeredBy, input }, fn)` from [lib/agents/run.ts](lib/agents/run.ts). It opens an `agent_runs` row, refuses to start a disabled agent, and closes the row with outcome, token counts, tool-call count, and proposals filed. Report usage with `run.recordUsage(response.usage, MODEL)` after each Claude call — a cron agent has no transcript, so the ledger is the only record that it ran at all.

**Autonomy is capped at `propose`. There is no auto tier.** An agent never mutates firm data directly; it calls `fileProposal(run, input)` from [lib/agents/proposals.ts](lib/agents/proposals.ts), which writes to `agent_proposals` and waits for a person. `fileProposal` refuses when the agent's tier isn't `propose` — a model can be argued out of a prompt instruction, not out of a function that won't insert. Widening this is a schema change and a firm decision, not a config flip.

- **The registry currently holds one agent: the assistant.** The court-mail autopilot was deleted with the inbox — it read ingested mail, so it had no input once that went. Its review surface (`/admin/email-proposals`) and the `agent_proposals` API went with it, because it was the only thing that ever called `fileProposal`.
- `lib/agents/` itself stays, unused filer and all. It is the safety architecture, not a feature: registration, the run ledger, and the `propose` cap are what make the *next* agent safe by construction. Nothing calls `withAgentRun` today — the assistant never did, and the one agent that would have is gone — so the ledger is dormant rather than live; the next agent to be written wraps its entry point in it. `agent_proposals` keeps its rows and its two payload kinds (`file_entry`, `deadline_chain`); the next agent to file into it will need a review surface built, since there is no longer one to generalize.
- **Worth reviving deliberately:** `lib/ai/deadline-trigger.ts` — the prompt that read an analysed court document and proposed a rule-set deadline chain — was deleted with its only caller. Its signature was email-shaped (`emailSubject`, `emailReceivedAt`), but the capability is not: pointing it at `file_analyses` would give it an input channel again. It is in git history, not gone.
- **Agent actions go in the audit log as the agent's.** Use `logAgentAudit` from [lib/audit.ts](lib/audit.ts), not `logAudit`; set `onBehalfOf` when a person instructed the agent (the assistant) and leave it null when nothing did (cron). Recording agent work under a lawyer's name is the specific failure this split exists to prevent. The assistant's write tools are audited centrally through `WRITE_TOOLS` in [lib/assistant/tools.ts](lib/assistant/tools.ts) — a new write tool must be added to that map.
- Agents run on crons, so they are service-role throughout (see the cron rule above). `agent_runs` is deny-by-default; `agents` is team-readable.
- **The assistant's read tools apply the matter gate themselves.** They run on the firm-scoped service client, which bypasses RLS, so without a check the assistant is a way around `has_matter_access`. `readableMatterIds` / `canReadMatter` in [lib/assistant/tools.ts](lib/assistant/tools.ts) mirror it for matters, deliverables and their files, hearings, meetings and tasks; files, clients and executive summaries stay firm-wide, as they are in RLS. A new read tool takes the member, not just the firm id, and applies the same check. Knowledge search does the same through the caller's own client: `searchKnowledge` requires a `viewer` ([lib/ai/knowledge-access.ts](lib/ai/knowledge-access.ts)).

## One codebase, one instance per firm — customization is configuration

Lumilex is sold as consulting (implementation and training for Philippine law
firms), not as a SaaS product. Each firm runs on **its own instance** — its own
Supabase project and its own Vercel project — and every instance builds from
this one repo and one branch. The reasoning, and the shared-instance topology
it replaced on 2026-09-25, are in
[docs/multitenancy-followups.md](docs/multitenancy-followups.md) → "One
codebase, one instance per firm".

- **[fleet/instances.json](fleet/instances.json)** lists every instance. Exactly
  one is the `test` instance — the current dev project — where the probes run.
  **No firm's data ever lands in it**, because the probes provision and delete
  real firms, auth users and storage objects wherever they run.
- **A schema change reaches every instance through `npm run fleet:migrate`**
  ([scripts/fleet-migrate.ts](scripts/fleet-migrate.ts)); see the Database
  section for the order.
- **Per-instance secrets stay per instance.** `INTEGRATION_CREDS_KEY` in
  particular must differ between instances, or one leak opens every firm's
  sealed credentials.

- **Lumilex is AGPL-3.0** ([LICENSE](LICENSE), copyright dfrdn). Its section 13 asks that whoever runs a modified version for others over a network offer them its source, so every surface a person signs in to links to it: `SourceLink` ([components/SourceLink.tsx](components/SourceLink.tsx)) sits on both sign-in pages, at the foot of the shared staff sidebar (`components/nav/SidebarNav.tsx`, so all four staff shells) and in their avatar menus under Sign out, and in the portal footer. The address is `SOURCE_URL` in [lib/source.ts](lib/source.ts): the upstream repository, or `NEXT_PUBLIC_SOURCE_URL` on an instance running modified code. A new signed-in surface with its own chrome carries the link too.

Two things follow, and they are editing rules rather than background.

**The tenancy machinery stays, and its gates stay load-bearing.** In production
the project is now the outer boundary and `firm_id` + RLS the second line, but
the code is shared: the test instance holds several firms on every probe run,
and a firm's instance runs exactly what the probes exercised. So `verify:rls`,
`verify:storage`, `verify:firm-id` and `verify:service-role` still gate every
change. Don't treat a red probe as noise from a change that "obviously can't
leak", and don't strip `firm_id` handling on the grounds that an instance holds
one firm.

**A firm's difference is configuration, edited on `/platform`.** Per-instance
deployment makes forking *easier*, so this rule matters more than it did under a
shared instance. When a firm needs something different, the first question is
which existing seam holds it —
`firms.branding`, `firms.settings`, `firm_integrations`, `FEATURE_KEYS`, the
seed pack, `firm_invoice_settings`. If none does, the answer is a new
firm-scoped setting **plus an editor on `/platform`** — never a per-firm branch,
never an env-var switch, never a constant keyed by slug. A consulting business
dies on N forks that cannot take an upstream security fix, and this is the rule
that prevents it. It only holds if it is applied the first time it is
inconvenient.

### Deliverable statuses: one vocabulary, asked by role

The deliverable pipeline's twelve status values live in one module,
[lib/deliverable-status.ts](lib/deliverable-status.ts), and nowhere else
(phase 0 of the plan in [docs/multitenancy-followups.md](docs/multitenancy-followups.md)
→ "Per-firm deliverable statuses", done 2026-09-28). Before it, they were
string literals in ~340 lines across 83 files, and "what counts as done" had
six answers — including filters on `Completed`, `Filed`, `Cancelled`, `Done`
and `Sent out`, statuses no deliverable holds. One of those meant the deadline
cron reminded people about work already filed.

- **Name a status with `DELIVERABLE_STATUS.X`; ask what it means with a role.**
  `FINALIZED_STATUSES` (filed or acknowledged — mirrors the database's
  `deliverable_status_is_finalized()`; change both together),
  `DELIVERED_STATUSES` (reached the court or client — the portal's "delivered"),
  `CLOSED_STATUSES` (finalized or archived — nothing left to do; everything else
  is open work), `HANDED_OFF_STATUSES` (closed, plus internal work submitted and
  awaiting acknowledgement — a lawyer's own queue). Each has an `is…` predicate.
  A PostgREST filter over a role is `.not('status', 'in', pgInList(CLOSED_STATUSES))`
  ([lib/postgrest.ts](lib/postgrest.ts)).
- **The set a deliverable can hold depends on its type.** `statusesForType`:
  internal deliverables run `INTERNAL_PIPELINE_STATUSES` (Not started →
  Drafting → Submitted → Acknowledged); every other type the external pipeline.
  Status pickers use `pickableStatusesForType`, which leaves out Archived —
  archiving has its own confirmed action. `STATUS_ORDER` is board *layout*, not
  the set.
- **`npm run verify:status-literal`** ([scripts/audit-status-literals.ts](scripts/audit-status-literals.ts),
  rule in [lib/deliverable-status-literals.ts](lib/deliverable-status-literals.ts))
  fails on a string literal equal to a deliverable status anywhere else —
  parsed with the TypeScript compiler, so comments and longer strings don't
  count, and items of a PostgREST list like `'("Filed or Sent out","Archived")'`
  do. Tests are exempt; they assert on stored values. The few legitimate other
  uses — UI copy that spells "Submitted", the SEC registration pipeline's own
  `'Drafting'`, the admin table's entity-generic archive — are counted per file
  with a reason in `ALLOWED_STATUS_LITERALS`, so a new literal in those files
  still fails.
- **The same words belong to other entities, under real CHECK constraints.**
  `matters.status` is Ongoing / Done / Archived ([lib/matter-status.ts](lib/matter-status.ts)),
  `tasks.status` is Not started / In progress / Done ([lib/task-status.ts](lib/task-status.ts)),
  hearings use [lib/hearing-status.ts](lib/hearing-status.ts), and
  `corporations.esparc_status` has its own 'Drafting'. A repo-wide
  find-and-replace on these strings corrupts them — which is why each has its
  own module, and why the gate exempts those two files.
- **The strings are stored values, not labels.** `deliverables.status` is plain
  `text`, and four SQL sites (two trigger functions) match on these exact
  values, so renaming a status is a data migration. Per-firm labels are phase 2.
- **One Deliverables list, with saved filters in the URL**
  (`/dashboard/deliverables?view=`, [lib/deliverables/views.ts](lib/deliverables/views.ts)):
  Mine (the default, with no `view`, so a link to the firm-wide list says
  `view=all`) · All · Filings · Status reports · Internal · By status
  (`&status=`). The old `/dashboard/filings`, `/status-reports`, `/internal`
  and `/deliverables/by-status` pages redirect to their view
  ([lib/nav/retired-routes.ts](lib/nav/retired-routes.ts)), and
  `/dashboard/filings/<id>` opens the deliverable.
- **There is no `filings` database view.** A filing is
  `deliverables WHERE type = 'External' AND external_due_date IS NOT NULL`;
  read that. `global_search` reads the table since
  `20261123_retire_filings_view_readers.sql`, and
  `20261123_drop_filings_view.sql` drops the view.

## Per-firm features and BYO credentials

Not every firm buys every integration, and no firm should be reachable through another's. [lib/firm/features.ts](lib/firm/features.ts) is the single place the guard matrix is expressed; it borrows the agents registry's rule — **an unregistered feature is disabled, never unrestricted**, and the refusal lives in a function that won't run.

**Three levels, all of which must hold.** `resolveFeature(firmId, key)` returns `{ available, reason }`; `isFeatureAvailable` and `requireFeature` wrap it.

1. **Entitlement** — `firms.settings.features[key] === true` (`isFeatureEnabled(config, key)`). A key absent from the map is off.
2. **Registration** — a `firm_integrations` row for `(firm_id, feature)` with `enabled = true`. No row is off.
3. **Credentials** — for a bring-your-own integration, every secret and config field it needs. For everything else, the platform prerequisite (`isMailConfigured()`, `isVoyageConfigured()`, VAPID keys, `FIRECRAWL_API_KEY`).

`evaluateFeature()` is the pure core of that decision and is tested mocklessly; `resolveFeature` is just IO around it. **Never re-derive the rule at a call site** — ask, and act on the answer.

- **Feature keys** are fixed in `FEATURE_KEYS` ([lib/firm/feature-shape.ts](lib/firm/feature-shape.ts)): `portal`, `sharepoint`, `docx_pdf`, `push`, `issuances`, `drafting`, `red_team`, `ai_analysis`, `ai_search`, `ai_assistant`, `ai_client_chat`. Adding one means adding the key, its spec entry, and a row per firm that should have it. The seven AI-reaching keys are also collected in `AI_FEATURE_KEYS` — see the AI gate section above.
- **`firm_integrations`** (`20260823_firm_integrations.sql`) is a tenant table, RLS-enabled with no policies — service-role only, read through `getServiceDbForFirm`. `config` jsonb holds the non-secret half (directory id, application id, drive user, SharePoint site); `credentials_enc` holds one AES-256-GCM blob over a JSON bag of secrets. `scripts/rls-probe.ts` asserts that no persona — not even the owning firm's partner — can read it through PostgREST.
- **Sealing** is [lib/firm/secrets.ts](lib/firm/secrets.ts): `sealSecretBag` / `openSecretBag`, keyed by `INTEGRATION_CREDS_KEY` (32 bytes, base64 or hex; `openssl rand -base64 32`). It is in `REQUIRED_PLATFORM_ENV` and validated at boot — a key that is present but the wrong size is the same outage as a missing one, found later. Nothing in that module logs plaintext, and an open failure is deliberately opaque. Rotating the key invalidates every blob: re-seal first.
- **Microsoft Graph has no platform fallback.** `getGraphConfigForFirm(firmId)` returns the firm's own app or `null`; every exported function in [lib/microsoft-graph.ts](lib/microsoft-graph.ts) takes `firmId` first and its token cache is keyed on `tenantId:clientId`. An app registration lives in one Entra directory, so lending the platform's app to a second firm would not fail cleanly — for SharePoint and OneDrive it would *succeed*, filing that firm's client documents into the first firm's library, outside anything RLS can see. The single escape is `config.usePlatformEnv: true`, an explicit per-firm declaration that the platform app *is* that firm's app; the dev firm carries it, a firm onboarded later does not.
- **Which keys stay platform-wide:** Anthropic, Voyage, Firecrawl (per-request compute, not identity), and Resend — one platform API key, but the from-identity is the firm's own and *every* client-facing send now rides on it (see the mail section below). DNS is the per-firm half: an address whose domain is not verified in the platform's Resend account is rejected at send time, so standing a firm's billing box up is two DNS records rather than an Entra app registration. Graph is per firm.
- **Cron fan-out:** use `forEachFirmWithFeature(key, fn)` from [lib/tenancy/fan-out.ts](lib/tenancy/fan-out.ts). A skipped firm stays in the results with a `skipped` reason — an absent firm and a firm that did nothing look identical from the outside, which is exactly what hid two silently-broken crons before.
- **UI:** gate the server component (redirect or `notFound()`) **and** suppress the way in. Suppress by not rendering: a firm without a feature gets no disabled control and no upsell.
  - **Navigation reads a context, not a prop.** Each role layout resolves the whole map once with `resolveFeatureFlags(firmId)` and mounts [components/FeatureProvider.tsx](components/FeatureProvider.tsx); the `'use client'` shells call `useFeatures()` and drop any nav entry whose `features: FeatureKey[]` isn't satisfied (`featuresVisible` — several keys mean *any* of them, so a page worth showing while any one of the integrations behind it is on names them all). The shells are constructed per page — 67 files for `DashboardShell` — so a flags prop is one a new page forgets, and that page then advertises a link to a route the server redirects away from. Same reasoning, same shape, as `BrandProvider`. Gating a new entry is one field on the nav item; the context default is every flag false, so a subtree outside a provider shows nothing rather than guessing.
  - `lib/firm/features.ts` is server-only and must never be imported into a client component — it reaches `node:crypto` and web-push through the platform predicates. The client-safe key set, the `FeatureFlags` shape and `featuresVisible` live in [lib/firm/feature-shape.ts](lib/firm/feature-shape.ts), which `features.ts` re-exports; same split as `lib/firm/brand-shape.ts`.

## Provisioning a firm

Onboarding is **operator-run** — no public signup, no billing. `scripts/provision-firm.ts` is the whole front door: `npx tsx scripts/provision-firm.ts <config.json> [--dry-run]`. The config is a JSON file ([lib/provisioning/config.ts](lib/provisioning/config.ts) holds its Zod schema and the reasoning) and carries no secret — the first admin's password is generated and printed once, or comes from `PROVISION_ADMIN_PASSWORD`.

- **Idempotency is "fill what is absent, never overwrite what is present."** Re-running the same config must not reset completed bank details to placeholders or switch an enabled integration back off. Every step reads before it writes. Never add an unconditional upsert to it.
- **Slug and invoice prefix are validated against the database's own CHECK patterns**, read at runtime via `provisioning_patterns()` (`20260823_provisioning_patterns_rpc.sql`), so a bad value fails with a readable message instead of a 23514 — and a widened constraint never leaves the script rejecting input the DB would take.
- **A domain already claimed by another firm is refused, not reassigned.** `firm_domains` resolves a host to a firm *before* auth, so re-pointing one would serve that firm's branding and sign-in under another name.
- **`firm_invoice_settings` is written deliberately incomplete**: a real `invoice_prefix` (`allocate_invoice_number` needs it) and `invoicePlaceholder(...)` values for everything that says where money goes. `getFirmInvoiceSettings` throws on a blank *or* placeholder required field, naming them — so invoicing, `regenerate-invoice`, the proposal's payment block and the branded DOCX letterhead all stop until finance completes it. `missingInvoiceSettings()` is the pure rule; don't re-derive it at a call site.
- **Every `firm_integrations` row is written disabled.** The entitlement half (`firms.settings.features`) comes from the config; the switch is the operator's, after credentials.

- **The Rules of Court and the codes are a separate step.** `provisionFirm()`
  does not load them — 943 sections and 505 articles and sections are not
  seed content, and the imports embed them when the firm has `ai_search`. Run
  `npx tsx scripts/import-rules-of-court.ts <firm>` and
  `npx tsx scripts/import-legal-codes.ts <firm>` once the firm exists; both are
  idempotent, so re-running after a data update changes only what changed.

### The seed pack ([lib/provisioning/seed-pack/](lib/provisioning/seed-pack/))

Neutral starting content, as data modules, held to three rules by `seed-pack.test.ts`: **no identity** (no firm, client, person, address, or contact detail), **no money** (nothing carries a price a firm did not set — where a schema demands a number the row is omitted instead of invented; `billing_rates.hourly_rate` is NOT NULL so it is 0, which is obvious rather than plausible), and **no `firm_id`** (rows are stamped by `getServiceDbForFirm`).

- **The fee-schedule seed is unpriced, and there is no fallback behind it.** `lib/fee-schedule/default.ts` used to hold one real firm's 2026 rate card and `loadFeeSchedules` layered saved rows over it per slug, so a firm that had never saved a schedule quoted — and bound as Annex "A" — another firm's prices. That file is deleted: [lib/fee-schedule/load.ts](lib/fee-schedule/load.ts) now throws when the firm has none, and every path that quotes or renders a schedule inherits that (`findFeeSchedules` is the non-throwing reader the settings CMS needs). A firm quoting no rates is recoverable; a firm quoting someone else's is not. Keep the seeded schedules unpriced — `pricedTiers()` must return nothing.
- `resolution_templates.id` is a **global** text PK with no `(firm_id, id)` unique, so seeded ids are namespaced `<slug>:<key>` by `resolutionTemplateId()`. An un-namespaced upsert lands on whichever firm seeded first.
- Deliberately not seeded: `firm_expense_templates` and `transportation_zones` (the firm's own vendors and geography), `drafting_style_profiles` (derived from the firm's finalized work), the global tables, and `'placeholder'`-mode document templates (those are DOCX binaries, uploaded per firm).

## Whitelabel hosts — the proxy's host binding

`firm_domains` resolves a hostname to a firm *before* anyone authenticates, and
the branding painted on the page is resolved from that host. So the host a
request arrives on and the firm its session belongs to have to agree, or a
signed-in user is shown someone else's tenant. [proxy.ts](proxy.ts) enforces
that after the team/portal lookups, and the rules are:

- **A mismatch is always resolved by redirecting, never by serving anyway.**
  When the request host maps to firm B and the session belongs to firm A, the
  user goes to A's primary domain — and when A has **no** primary domain, to
  the platform's own origin (`APP_BASE_URL`), which is the same fallback
  `firmBaseUrl()` uses for a domainless firm. Falling through to serve the page
  was the old behaviour and it meant A's staff worked under B's name and mark,
  on B's domain; a firm with no primary domain is a state the operator firms
  list explicitly flags, so it is expected rather than hypothetical.
- **The platform-origin fallback is loop-guarded.** If the platform's own
  hostname is itself mapped in `firm_domains`, redirecting to it would land
  right back in this branch — so the fallback is skipped when the request host
  already *is* the platform host. Compare hostnames only: strip the port and
  lowercase both sides.
- **Carry `req.nextUrl.search` with the pathname.** A host bounce is the entire
  response to a link somebody followed, so dropping the query silently discards
  the filter, page or token that link was for. Both redirects in this block and
  the `/platform` host redirect build their destination from
  `` `${pathname}${search}` ``.
- **Unmapped hosts are a no-op.** No `firm_domains` row means no binding to
  enforce, which is what keeps preview deployments and `localhost` working.
- `/platform` is exempt by construction: its branch returns before this code,
  so a staff-who-is-also-an-operator is never bounced off the platform host
  onto their firm's domain. See the operator-surface section below.

## The platform operator surface (`/platform`)

The one surface that is deliberately cross-tenant. Everything else in this app
is firm-scoped and the machinery resists this on purpose; the friction is the
feature, so **do not weaken shared machinery to make operator work easier** —
no widening of `firms_self_select`, no multi-firm mode on `getServiceDbForFirm`,
no cross-firm reach for the authed client. The operator path carries its own
authorization instead.

**A platform operator is a third identity kind, not a staff member with extra
rights.** `platform_operators` (`20260824_platform_operators.sql`) is keyed on
`auth_user_id`, carries **no `firm_id`**, and is deny-by-default RLS —
service-role only, and listed in the *global* set in
`scripts/generate-tenant-registry.ts` so the fail-closed facade doesn't throw on
it. `super_user` is a `team.role` and must never reach here: a firm-scoped row
granting cross-firm power is precisely the coupling the conversion removed.

- **`getOperatorSession()`** ([lib/platform/auth.ts](lib/platform/auth.ts)) is
  the third session alongside `getSession` / `getPortalSession` — React `cache`,
  the shared `getAuthUserId()` from [lib/session.ts](lib/session.ts) for the
  Bearer-or-cookie rule, and `active` inside the query so a deactivated operator
  is indistinguishable from someone who never was one. `requireOperator()` is
  the API guard, in the shape of `requirePortalSession`.
- **A person may be both** an operator and some firm's staff. Legal, and the two
  sessions stay distinct: this module never reads `team` and `lib/session.ts`
  never reads `platform_operators`. Being an operator adds nothing to a firm
  surface; a `team` row grants nothing on `/platform`. Nothing merges them.
- **[proxy.ts](proxy.ts) branches on `/platform` (and `/api/platform`) before
  the team and portal lookups** and returns without falling through, so
  ordinary firm traffic never pays for the operator read and an operator never
  hits the whitelabel host binding — which would otherwise bounce a
  staff-who-is-also-an-operator off the platform host onto their firm's domain.
  A non-operator is **redirected to `/dashboard`, never 403'd**: a 403 confirms
  the surface exists to anyone who guessed the path. The reciprocal case (an
  auth user who is neither staff nor a portal client) checks operator status in
  the `!isTeam` branch and lands on `/platform`, so signing in doesn't loop.
- **`/platform` answers on the platform's own host only** — `APP_BASE_URL`'s
  hostname. A tenant host is that firm's front door; serving the cross-tenant
  surface there would render it under the firm's branding and advertise it on
  their domain. An operator on the wrong host is redirected to the right one.
  The proxy reads the env directly rather than importing
  [lib/app-url.ts](lib/app-url.ts) — same edge-runtime constraint as the
  `portalEnabled` comment in that file.
- **The shell is its own.** `app/platform/` does not reuse the role shells:
  those are firm-scoped and paint one tenant's monogram and palette, and an
  operator has no firm whose branding would be right.
- **Reading *into* a tenant is audited**, unlike the firm-scoped reads
  everywhere else — a firm-scoped read is unremarkable, an operator opening a
  tenant's configuration is not. `logOperatorAudit` ([lib/audit.ts](lib/audit.ts))
  writes `actor_type = 'operator'` with the operator's `auth_user_id` in
  `performed_by`, into **the firm the action concerns**, so it lands in that
  tenant's own `/admin` audit log. An action touching several firms writes one
  row per firm (`logOperatorAuditAcrossFirms`). There is deliberately no
  sentinel "platform" firm and `audit_log.firm_id` stays NOT NULL.
  - **The firms *list* is deliberately not audited** — neither
    `app/platform/page.tsx` nor `GET /api/platform/firms`. The roster and its
    health counters are a platform-level fact about which tenants exist;
    `/platform/firms/[id]` is where a tenant's configuration is actually read,
    and that page audits, as does every mutation. The first cut logged a row
    per firm per list render and was self-defeating: a server component has no
    dedup, so every visit and re-render fanned N inserts across N tenants and a
    few minutes of ordinary navigation buried the mutations a tenant's admin
    needs to see. Recording less, in the one place it means something, is what
    keeps that trail readable. If list views ever need coverage, it needs a
    dedup key (one row per operator per firm per day) and somewhere to hold
    that state — **not** a re-added loop.
- **The allowlist entry is narrow and reasoned, and phase B did not grow it.**
  `lib/platform/auth.ts` and `lib/platform/firms.ts` are their own
  `platform-operator` group in [eslint.config.mjs](eslint.config.mjs). Both
  touch **global** tables only (`platform_operators`, `firms`, `firm_domains`);
  everything inside a firm — team counts, integrations, invoice settings — goes
  back through `getServiceDbForFirm(firm.id)`, so the list is N+1 by design and
  the facade still pins every tenant query to a named firm. The write side
  follows the same split, which is why it is where it is: global-table writes
  live in `firms.ts`, the operator roster in `auth.ts` (it already owns that
  table), tenant-table writes in
  [lib/platform/firm-detail.ts](lib/platform/firm-detail.ts) — which reaches for
  no raw client and is therefore not on the list at all. **A new operator
  feature belongs in one of those three files**; a fourth entry is a decision to
  write down, not a convenience.
- **First operator:** `npx tsx scripts/bootstrap-platform-operator.ts <email>
  <password> [name]`. Idempotent per email; binds to an existing auth user when
  the person already has one (never resetting their password); cleans up the
  auth user it created if the second write fails. Revocation is
  `active = false`.
- **The gate is `npm run verify:platform`**
  ([scripts/platform-probe.ts](scripts/platform-probe.ts), 66 checks). It drives
  the real HTTP handlers with a cookie jar — bearer tokens don't work, the proxy
  redirects a cookieless request — and asserts the matrix both ways: anon, a
  firm's `super_user` and a deactivated operator are refused; an operator and a
  staff-who-is-also-an-operator get in and see every firm. The allow checks are
  the controls: a broken fixture refuses everyone and would pass a deny-only
  probe. **Every mutation is in that matrix, and every deny attempt sends a body
  that would have worked** — a deny check the validator rejects first passes
  with the guard deleted. The sweep is followed by assertions that nothing
  actually changed, because a redirect that still performed the write is exactly
  what a status-only check cannot see. **Add a route, add its row to
  `MUTATIONS`.**

### Phase B — the management forms

- **One provisioning path, two front doors.**
  [lib/provisioning/provision.ts](lib/provisioning/provision.ts) holds what
  `scripts/provision-firm.ts` used to: the CHECK patterns read from the database
  via `provisioning_patterns()`, the domain-hijack refusal, the
  fill-what-is-absent idempotency, the deliberately incomplete invoice row, the
  all-disabled integrations, the seed pack, the first admin with orphan cleanup.
  The script is now the file-and-console half and `/platform/firms/new` posts
  the same config object to the same `provisionFirm()`. **Do not add a second
  definition of what a valid firm is** — if the two paths ever disagree, that is
  the bug this split exists to prevent. The script's JSON-config interface is
  unchanged: it stays the operator's reviewable, replayable record of what a firm
  was provisioned with.
- **The engine takes its client as a parameter** and imports `@/lib/supabase`
  nowhere. That is what keeps it off the allowlist: global tables through the
  injected client, every tenant table through `getServiceDbForFirm(firmId, db)`.
- **Editors validate through the loader's own schemas.** `brandingSchema`,
  `emailSchema` and `documentsSchema` are exported from
  [lib/firm/config.ts](lib/firm/config.ts) and the PATCH route parses with them,
  so nothing can be written into `firms.branding` / `firms.settings` that
  `getFirmConfig` reads back as a default. Same principle elsewhere: the invoice
  form surfaces `missingInvoiceSettings()` (the rule billing already throws on),
  the feature rows show `resolveFeature()`'s own `reason`, and the font-set
  selector is built from `FONT_SETS`. `featureRequirements(key)` exists so the
  form renders one input per field the guard actually checks rather than a
  second copy of the matrix.
- **Credentials are one-way.** They are sealed by `lib/firm/secrets.ts` on the
  way in and **never rendered back** — `readFeatureRows` reports which names hold
  a value, never the value, and the audit line names the fields, not their
  contents. Replace or clear; there is no read.
- **Storage paths, not uploads.** Branding asset slots are text fields recording
  where a mark lives. An uploader was out of scope for v1.
- **`firms.status` is honest about its blast radius.** It is read in exactly one
  place — `forEachActiveFirm` — so suspending a firm stops the crons and nothing
  else. It does not block sign-in or the portal, and the UI says so rather than
  implying a kill switch.
- **The surface will not close itself.** `checkOperatorDeactivation`
  ([lib/platform/operator-lockout.ts](lib/platform/operator-lockout.ts), pure and
  unit-tested) refuses to deactivate the last active operator — whoever asks,
  confirmed or not, because the operator confirming cannot undo it and recovery
  is `scripts/bootstrap-platform-operator.ts` with the service-role key.
  Deactivating *your own* access while others remain is allowed but needs an
  explicit `confirmSelf`.
- **Roster changes are audited into every firm.** Granting operator access is
  firm-less in shape but not in effect — it is a new person who can read and edit
  every tenant — so it goes through `logOperatorAuditAcrossFirms(allFirmIds())`.
  Still no sentinel firm.

## The public demo (`demo.lumilex.co`)

A fictional firm, Lumilex & Partners, that anyone can sign in to with one click as a
partner, associate, finance, office admin or liaison, reset every night. It is a
firm on the **test** project, configured like any firm, served by the `lumilex-demo`
Vercel project building `main`. Runbook: [docs/demo-instance.md](docs/demo-instance.md).

- **The one-click sign-in holds three conditions, and they live in
  [lib/demo/sign-in.ts](lib/demo/sign-in.ts)** (pure, tested; the route is
  [app/api/auth/demo/route.ts](app/api/auth/demo/route.ts)): the deployment has
  `LUMILEX_INSTANCE_ROLE=demo`, the host's firm has `settings.demo.enabled`, and the
  role maps through `settings.demo.personas` to an active, non-super_user staff row
  with a login. The persona is resolved from the firm's settings, never from the
  request, and no password exists for it — the session is an admin magic-link token
  verified server-side.
- **A visitor asks for access before the first sign-in** ([lib/demo/access.ts](lib/demo/access.ts),
  pure and tested). A name, work email and position, posted from lumilex.co/demo or
  the demo's own login page to `POST /api/auth/demo`, are stored in
  `demo_access_requests` — a *global* table (no firm_id; it belongs to no tenant),
  service-role only, read and written only through
  [lib/demo/access-store.ts](lib/demo/access-store.ts) — and the row's id comes back
  as the `lumilex_demo_access` cookie. The GET one-click link signs in only with that
  cookie; without it the visitor lands on the form. The row survives the nightly
  reset, which restores the firm and nothing else. `scripts/demo-probe.ts` asserts the
  refusals (no cookie, a forged one, an empty request) and the controls, and deletes
  its own rows.
- **`LUMILEX_INSTANCE_ROLE` is the one sanctioned env-var switch in the codebase.**
  Everywhere else a firm's difference is configuration, never an env var. This one is
  an interlock, not a customization: a mistaken `/platform` edit to a real firm's
  `settings.demo` cannot open that firm's staff accounts to the internet, because
  their deployment does not declare itself a demo. Do not add a second.
- **The refusals key on the firm, not the deployment** — `refuseInDemo(firmId, what)`
  from [lib/demo/guard.ts](lib/demo/guard.ts). Everything a visitor does inside the
  firm is fine; the nightly reset puts it back. What is refused is what the reset
  cannot put back or what reaches past the firm: user accounts and passwords
  (`auth.users` is not the firm's rows), portal invitations, global tables
  (`ph_holidays` through `/api/admin/[entity]` and batch import, `rule_sets` and
  `rule_deadlines` through `/api/partner/rules`), and profile photos (the `avatars`
  bucket is public). **A new route that writes auth, a global table or a public
  bucket calls `refuseInDemo`**, and gets a row in
  [scripts/demo-probe.ts](scripts/demo-probe.ts) — refusal and control, through the
  real handler, against a dev server in demo mode.
- **The login page is the role picker on the demo** and the root layout adds a
  banner and `noindex`, both only when `resolveRequestDemo()`
  ([lib/demo/request.ts](lib/demo/request.ts)) says the request is on it. The proxy
  carries the query string onto `/login`, so a marketing link to
  `https://demo.lumilex.co/?as=partner` signs straight in.
- **The reset is not a migration and must never become one.**
  [scripts/demo/reset.sql](scripts/demo/reset.sql) (the `demo_snapshot` schema, the
  `demo-golden` bucket, the Vault secret, the pg_cron job) and the `demo-reset` edge
  function ([supabase/functions/demo-reset](supabase/functions/demo-reset/index.ts))
  are installed by hand on the test project. A function that deletes and rewrites a
  whole firm must not reach a firm's instance, even guarded. The test project
  therefore carries objects no migration created; a fresh-bootstrap schema diff
  must exclude `demo_snapshot`.
- **Retake the snapshot after a migration that changes a seeded table**
  (`select demo_snapshot.invoke('snapshot')`, after the runbook's AI pass if the
  content was rebuilt). Restore tolerates drift but not a new NOT NULL column
  without a default.
- **Everything in it is invented and held to it by hand**: no real firm, person,
  client, bank account or TIN; staff at `@demo.lumilex.co`, client contacts on the
  reserved `.example` TLD. `verify:brand` reads `scripts/demo/` but only for the
  origin firm's name; that nothing else in it is real is still checked by hand.

## The calendar feed

Staff subscribe to their hearings, meetings and deadlines; Lumilex no longer
pushes events into anyone's Outlook. The Graph calendar path — `lib/calendar-sync.ts`,
`/api/admin/calendar-sync`, `createOutlookEvent` and friends, the `graph_calendar`
feature key — is deleted, and with it the firm's need for a Microsoft account to
put a hearing on a lawyer's calendar. It works the same in Outlook, Google and
Apple Calendar.

- **The feed is derived, never stored.** [lib/calendar/feed.ts](lib/calendar/feed.ts)
  reads the same three sources the push used, with the same per-person filter:
  hearings and meetings the person attends (`attendee_ids`), deliverables
  assigned to them (`currently_with_ids`). Nothing is mirrored, so nothing can
  drift — and a deleted hearing simply stops appearing, which is why
  `deleteDeadlineChain` no longer tears down calendar events.
- **The token is a bearer credential and is treated as one.** It rides in a URL
  that Outlook and Google store on their servers and replay unauthenticated,
  forever. So it lives in `calendar_feed_tokens` — its own table, RLS-enabled
  with no policies — and *not* on `team`, whose `team_authenticated_select`
  policy lets every colleague read every column of every row. RLS is row-level;
  there is no way to exempt one column. Rotation is revocation: replacing the
  token is what kills a leaked URL, and the UI says so. `scripts/rls-probe.ts`
  seeds a real token row per probe firm, so its deny checks fail to reach
  something that exists rather than something that was never there.
- **`GET /api/me/calendar-feed` does not mint.** A feed is created when someone
  asks for one, not because they opened Settings — otherwise every account
  carries a live unused key to its own calendar.
- **[app/api/calendar/[token]/route.ts](app/api/calendar/[token]/route.ts) is
  unauthenticated by construction** and excluded from the proxy matcher: a
  calendar client cannot follow a redirect to `/login`. It resolves the token
  itself (a firm-resolution lookup, with the marker comment and the eslint
  allowlist entry that pattern requires) and answers an unknown token with a
  bare 404 that says nothing about whether the firm exists.
- **The escaping and folding rules are the fragile part**, so they are pure and
  tested in [lib/calendar/ics.test.ts](lib/calendar/ics.test.ts): a client
  rejects the *whole* feed over one malformed line, so an unescaped comma in a
  matter name silently empties somebody's calendar. Folding is measured in
  octets, not characters. An all-day `DTEND` is exclusive.
- **The feed is a window, not the whole calendar** — `FEED_PAST_DAYS` (90) back,
  `FEED_FUTURE_DAYS` (365) forward. A client re-fetches the entire document on
  every poll, so unbounded grows without limit; the past window is there so
  somebody who subscribes today sees recent context instead of an empty
  calendar until their next hearing.
- **The known cost** of a feed over a push is latency: Outlook and Google poll
  on their own schedule, often hours, and treat `REFRESH-INTERVAL` as advisory.
  A hearing moved this morning may not reach a subscriber's calendar today.
- **The deletion's leftovers are gone too.** `calendar_sync_events`,
  `team.calendar_sync_enabled` and the `graph_calendar` rows seeded by
  `20260823_firm_integrations.sql` sat inert in the database for a while after
  the code went; they were dropped in
  `20260829_drop_telegram_attendance_calendar_sync.sql`.

## Telegram and clock-in are gone

Both were cut in the first scope reduction: they encoded one firm's way of
working rather than anything a second firm would recognise. The Telegram
assistant needed staff to adopt Telegram and was never per-firm routable
anyway; the clock-in gate blocked the dashboard until you punched in, which is
a labour-control decision, not a practice-management one.

- **The assistant survived the Telegram cut.** It was the same toolset behind
  both surfaces, so the generic half moved rather than died:
  `lib/telegram/dates.ts` → [lib/assistant/dates.ts](lib/assistant/dates.ts),
  `TelegramMember` → `AssistantMember` in
  [lib/assistant/tools.ts](lib/assistant/tools.ts), and `getAppBaseUrl()` →
  `appBaseUrl()` from [lib/app-url.ts](lib/app-url.ts) (one base-URL helper
  instead of two, and `TELEGRAM_APP_URL` is no longer read).
- **The database is clean too.** `telegram_link_codes`,
  `telegram_messages`, `attendance`, `team.telegram_user_id` and the orphaned
  `telegram` / `graph_calendar` rows in `firm_integrations` were dropped in
  `20260829_drop_telegram_attendance_calendar_sync.sql`, once each had been
  confirmed to have no code reference, no inbound foreign key, no view and no
  function depending on it. Written as plain `DROP`, not `DROP ... CASCADE`:
  equivalent with no dependants, and loud rather than silent if that changes.
- **`npm run verify:live` lost a check and got it back.** The cron probe's
  per-firm error isolation test poisoned `attendance.date_label` — the last
  TEXT column holding a date among the tables the remaining crons read. Its
  replacement poisons `files.file_urls`, which is jsonb: Postgres rejects
  malformed JSON there, but a jsonb **scalar string** is valid, comes back from
  supabase-js as a JS string, and so takes `/api/file-analysis/backfill`'s
  `typeof file_urls === 'string'` legacy branch straight into a throwing
  `JSON.parse`. Cheap by construction — the parse throws before any analysis
  starts, and each firm only reads its own batch.

## Evaluations and bonuses are gone

Cut for the same reason as the clock-in gate: the quarterly rubric, the partner
profit shares, the associate bonus pool, the discretionary and "other" bonuses
and the managing-partner-gated deliberation lock encoded one firm's
compensation politics, and no two firms share a bonus model. The five tables
went with the code in `20260829_drop_evaluations.sql` (all empty, no external
foreign keys, no views, no functions).

- **It is why `verify:brand` is not a sufficient de-branding gate — and why
  `verify:person-shaped` now exists beside it.**
  `lib/evaluations/partner-shares.ts` held one real firm's partner profit
  percentages keyed by their **initials** — `{ ADC: 0.40, BEL: 0.30, ... }`.
  The gate greps for the firm's *name*, so initials, nicknames and
  person-shaped enum values pass straight through it. Look for this shape by
  hand when de-branding; it is not rare.
- **The same shape was found on the lawyers surface and cut too.**
  `team.bonus_profile` fed `bonusProfile: 'standard' | 'qzx'`, and `'qzx'` —
  one person's initials — selected a different indicative bonus band (0.25–0.5
  months against 0.5–2.0) and rendered a literal "QZX" badge on the lawyer
  detail page. The whole "Bonus profile" card went rather than just that
  branch: the surviving `standard` band was equally one firm's compensation
  policy hardcoded in a component, and with evaluations gone there is no bonus
  process behind the range it showed. Column dropped in
  `20260829_drop_bonus_profile.sql`. The Monthly salary card stays — salary is
  real and drives finance's profitability labor costs.
- **Two finance surfaces were changed, not broken.**
  `/api/finance/firm-summary` took an optional `?periodId` to resolve a date
  window; its only caller was the deliberation view, so that branch is gone and
  the route keeps its `from`/`to` form. `/api/finance/cash-flow` folded
  `bonus_pool_php` in as a money-out line; with no way left to set a pool the
  input was permanently empty, so it is removed. **A firm that pays bonuses
  records them as a `firm_expenses` row**, which cash-flow already sums, and
  `BONUS_CATEGORY` still colours that category distinctly in the dashboard.
- `isManagingPartner()` stays — evaluations was never its only consumer. DTR
  review, billing review and salary editing all still ask it.

## The de-branding gates are two, not one

`verify:brand` greps for the origin firm's **name**. That is the whole of what
it can do, and it is not the whole of the problem: a real person encoded as
**initials** passes it every time, and did — `PARTNER_PROFIT_SHARES = { ADC:
0.30, ... }` and `bonusProfile: 'standard' | 'qzx'` both sat in `lib/` for
months under green runs of it. Both were found by reading code during an
unrelated cut, which is not a gate.

**`verify:person-shaped`** ([scripts/audit-person-shaped.ts](scripts/audit-person-shaped.ts))
is the other half. The rule and its allowlist are pure and live in
[lib/debrand/person-shaped.ts](lib/debrand/person-shaped.ts), so the negative
controls — both constants, reconstructed in their original shape — run in the unit suite; the
script is the IO around it. Same split as `evaluateFeature` / `resolveFeature`.

- **It does not decide what is a person, and cannot.** `qzx` and `bsp` are the
  same shape; only a human knows one is a name and the other is the central
  bank. So it is an allowlist ratchet, like `audit-service-role.ts`: it finds
  every short opaque token in the two positions where person-shaped data
  actually appeared — an object key mapping to a number, and a string-union
  member — and every one must be named in `ALLOWED_TOKENS` **in a group that
  says what kind of thing it is**. A new token fails until somebody answers
  "what is `RJT`?". That question is the whole value; don't add an ungrouped
  dump to make it pass.
- **Match on both sides of the pipe.** The first cut of the union rule matched
  only a token *followed* by `|`, so it missed `'qzx'` — the last member of its
  union, and the exact constant the gate exists for. The colocated negative
  control caught that before it shipped. Keep those tests honest: if either
  stops flagging, the gate is decorative.
- **Initials are not always uppercase.** `^[A-Z]{2,4}$` was the obvious first
  guess and it is wrong: `'qzx'` is lowercase. The rule is case-insensitive and
  position-based instead.
- Three files are exempt because they quote both constants — the rule module,
  its test, and the script. The initials and figures in them, and in this
  section, are stand-ins in the original shape; the real ones are not published. Rewording the canonical example to
  dodge the detector would be worse than exempting the files allowed to state
  it.
- **What it does not cover:** a person's full name in a string, a nickname
  longer than four characters, initials in a comment or in JSX text, and
  anything outside `app lib components scripts`. It is one shape, caught well —
  not a claim that de-branding is now automatic.

## Document generation

- DOCX: [lib/docx/](lib/docx/) using the `docx` library. Templates with placeholder substitution use `mammoth` for preview.
- **Wording the firm edits has one engine — reuse it, never build another.** Any standard text people change in the app (the billing letter and email, the trademark client reports) is edited with [LetterEditor](components/LetterEditor.tsx) and its `PlaceholderButtons` (fields as chips; `formatting` `basic` / `lists` / `full`), stored as markup converted at the editor's edge by [lib/letter-markup.ts](lib/letter-markup.ts) (`**bold**`, `*italic*`, `__underline__`, blank line between paragraphs, `- ` numbered items), and filled and checked by [lib/letter-wording.ts](lib/letter-wording.ts) (`{{field}}`, `[[ … ]]` dropping out on a blank field, `wordingProblem` against the document's own field set). A new editable document brings only its field list, its defaults, and a firm-scoped table for saved wording with a `content_revisions` entity type; it doesn't get a textarea, a second fill function, or its own markup parser. If the engine lacks something, extend it there so every document gets it. Defaults live in code; a firm that has saved nothing reads them, so no wording is seeded per firm.
- **Letters built from paragraphs go on the firm's letterhead through [lib/docx/on-letterhead.ts](lib/docx/on-letterhead.ts)** (`placeOnLetterhead(firmId, …)` over the template with the firm's letterhead built in) and [lib/docx/letter-body.ts](lib/docx/letter-body.ts), whose runs name no typeface so the firm's comes from the template's styles.
- XLSX: [lib/xlsx/](lib/xlsx/) using `exceljs`.
- PDF: `lib/pdf/` using `pdfkit` (rendering) and `pdf-lib` (merging finished documents).
  - **Branded outbound documents share one visual system, resolved per firm.** [lib/pdf/brand.ts](lib/pdf/brand.ts) turns a `firms.branding` row into a `Brand` (`brandFromConfig`) and holds the geometry and deco primitives; [lib/pdf/letterhead.ts](lib/pdf/letterhead.ts) builds the cover, interior page, running header/footer, section bands, and body typography on top. The engagement proposal, the fee schedules, the annex dividers and the billing breakdown all render through it — change the *shared layout* there, not in a single renderer, or a bound package stops matching itself.
  - **What is per-firm vs shared:** per-firm is the palette (two configured hex values, ramped into the full set by [lib/pdf/palette.ts](lib/pdf/palette.ts)), the cover name lines, the tagline, the typeface set, and the logo/monogram. Shared is the A4 geometry, the margins, and every primitive — keyline, corner brackets, deco bars, section headers, footers. Palette roles are named by *role* (`primary`, `accent`, `surface`), never by colour: a tenant with a burgundy mark must not have code filling shapes with `C.navy`.
  - **`brandedDocument(brand, opts)` opens every document.** The `Brand` rides on the pdfkit document (`doc.brand`) — a document is a single-use render context, so every helper reads `doc.brand.palette` rather than taking the brand through forty signatures. Load it once at the route boundary with `loadFirmBrand(firmId)` from [lib/pdf/firm-brand.ts](lib/pdf/firm-brand.ts); the DOCX equivalent is `loadDocxBrand(firmId)` from [lib/docx/brand.ts](lib/docx/brand.ts).
  - **Fail loud, never substitute.** An unset palette, name or document name throws with the setting to fix. An unknown `fontSet` throws. A bundled font set whose files or `LICENSE` are missing throws. The one thing that degrades quietly is a logo: "no logo configured" is legitimate and renders clean empty space — never a packaged stand-in mark, and never another firm's.
  - **Typefaces are a curated set chosen by name** (`firms.branding.fontSet` → `FONT_SETS` in [lib/pdf/fonts.ts](lib/pdf/fonts.ts)). Arbitrary font upload is out of scope. The default `standard` set bundles Cormorant (display) and EB Garamond (body) from `public/fonts/garamond/`, both SIL OFL; `core`, `serif` and `sans` are built from the 14 standard PDF fonts and embed nothing, for a firm that wants no font data in what it sends out. A set with real font files must carry a redistributable licence beside them as `public/fonts/<set>/LICENSE` — see [public/fonts/README.md](public/fonts/README.md). One face per file, never a variable font: pdfkit dedupes embedded fonts on their name records, so two named instances of one file collapse and every weight prints as whichever was opened first. A set declares `hasPesoGlyph`, and `peso(n, fonts)` prefixes "P" when it is false rather than dropping a notdef box — the bundled Garamond faces carry ₱ and the core faces do not.
  - **The currency prefix is the set's decision, and it reaches authored text too.** `peso()` covers the figures a renderer computes; an engagement proposal's fee table and its filled scope lines are *content*, written when the letter was drafted, and a proposal bound in front of its own fee schedules must not quote the same figure two ways. So `pesoSymbol(resolveFontSet(branding.fontSet))` is threaded to everything that writes an amount: the drafting prompt and its tool schema in [lib/ai/engagement-proposal.ts](lib/ai/engagement-proposal.ts), `scopeTokens`' `{{monthlyFee}}` / `{{initialFee}}` in [lib/engagement-proposal/scope.ts](lib/engagement-proposal/scope.ts), and the builder, through `pesoSymbol` on the proposal catalogue. **Never write a fixed symbol into a prompt or a formatter** — half the sets misprint whichever one you pick.
  - **Stored content is normalised at render, not trusted.** A firm can change `branding.fontSet` after a proposal is drafted, and a partner can type an amount by hand, so `inBrandCurrency` in [lib/pdf/engagement-proposal.ts](lib/pdf/engagement-proposal.ts) re-prefixes every amount with `brand.pesoSymbol` on the way to the page (`withCurrencyPrefix` in [lib/pdf/letterhead.ts](lib/pdf/letterhead.ts)). Substituting the glyph is not correcting a figure — the amount is untouched — which is why this is not the silent correction `checkQuote` deliberately refuses to make. It walks prose and figures only: client and signer names are left alone, because "P2 Logistics, Inc." is a client, not an amount. `scripts/render-brand-samples.ts` authors one fee row under the *other* symbol on purpose, so the sample proves the normalisation rather than the fixture.
  - Logos and monograms live in each firm's own storage prefix (`branding.logoPath` etc., resolved by [lib/pdf/brand-assets.ts](lib/pdf/brand-assets.ts)). They are downloaded to a temp *file* and handed to `doc.image()` as a path, not a Buffer — pdfkit only caches decoded images keyed on a string, and a Buffer re-decodes on every draw (~250ms each, ~12s over one firm profile). Don't "simplify" that to a Buffer.
  - Bundled font files are read from disk at runtime, so `public/fonts/**` is pinned in `next.config` `outputFileTracingIncludes` for every document-rendering route.
  - Rendered output is verified with `npx tsx scripts/render-brand-samples.ts [firmId]`, which renders the set for a real firm and asserts no other firm's name, mark or licensed font appears anywhere in the PDF, that each bundled weight arrived as its own embedded subset, and that every glyph shown decodes through its font's `/ToUnicode` (an embedded face writes glyph ids, not characters, so the script maps them back — without that every text assertion passes on a page it can no longer read). Then rasterise and look: `pdftoppm -png -r 100 .brand-samples/fee-schedule.pdf out`.
  - **pdfkit gotcha:** in a justified `continued` run, leading whitespace on the resuming fragment is dropped — a non-breaking space too. Put the separator on the end of the preceding run. `boldRuns()` in `lib/pdf/letterhead.ts` exists for this and is tested; don't "simplify" it.
- **The Word letterhead is built in code, from the firm's own brand, in one of three designs.** [lib/docx/letterhead.ts](lib/docx/letterhead.ts) writes both header parts from scratch (pure XML, tested) and [lib/docx/template-updater.ts](lib/docx/template-updater.ts) puts them into the neutral [lib/docx/template.docx](lib/docx/template.docx), which supplies only styles, the section and a sample body. **Classic** centres the monogram, the name and the address over a short accent rule; **Band** reverses the name out of a full-bleed band in `palette.primary`; **Ledger** ranges the name left and the address right over a double rule. Every design carries the roster across the foot of page one and a quiet running head after it, and needs what `loadFirmBrand` needs (palette, name lines, document name) — it throws without them.
  - **The design is configuration.** `branding.letterhead` ([lib/firm/letterhead-design.ts](lib/firm/letterhead-design.ts), editable on `/platform`) names one, or stays `auto`, which seeds one from the document name with a stable hash — so a firm that never chose still has a letterhead of its own, and two new firms seldom share one. A new design is a function in `letterhead.ts`, a key in `LETTERHEAD_DESIGNS` and a label; the zod enum follows from the list.
  - **Not the origin app's letterhead.** The origin firm's #270 design — a navy rail down the left edge with deco bars, a narrow right-hand roster column, the wordmark over a gold rule — was ported once and then taken out, because it is that firm's recognisable look. Don't reintroduce the rail-and-column shape as a design; a firm that wants something close to it gets a new design of its own.
  - **The roster holds the foot of page one only:** it is drawn in the first-page header with an empty spacer wrapped top-and-bottom, so the body stops above it there and runs to the ordinary bottom margin after. It exists once — no `mc:AlternateContent` VML fallback; the drawn template this replaced kept two copies of its sidebar, and rewriting only one left the template's people printing in the other. Counsel are listed by `ROSTER_GROUPS` in rank, then start date, then surname — never a per-name ordering, which would be one firm's people in the code.
  - **Band sets the name as type and uses only `monogramLightPath`**: a lockup drawn for white paper disappears on a coloured ground. Classic and Ledger use `logoPath` when it is set.
  - **Every style is set in the firm's face** (`applyStyleFont`, from the font set's `docxFamily`), and the cache key hashes the design, everything printed and `LETTERHEAD_VERSION` — bump it when a layout changes.
  - Until 2026-10-31 the bundled file was one firm's real letterhead with only the roster rewritten, so every firm's letters carried that firm's logo, sign-off and typeface. Never put a firm's mark, name or licensed face (even by name) back into it; `verify:brand` reads inside it and `letterhead.test.ts` asserts it has no media, no embedded fonts, empty headers and no Adobe face named.
- The seed templates in `scripts/template-seeds/` sign with `{{firm_name}}`, which `/api/templates/generate` fills from `branding.documentName`; they carry no letterhead, which a firm adds to its own copy.
- Generated files are uploaded via `lib/upload.ts` to Supabase Storage; SharePoint mirroring is best-effort via [lib/sharepoint-sync.ts](lib/sharepoint-sync.ts).

## Storage is a tenant boundary too

RLS covers rows. It does not cover objects, and the first cross-tenant leak of the rework was in storage: corporate-resolution and billing-letter templates fell back to a shared unprefixed path, so a firm without its own template rendered documents on another firm's letterhead (`5ce5c49`). `scripts/storage-probe.ts` is the gate — run it after touching any `.storage.from(...)` call or any bucket policy.

**The invariant: an object key starts with the owning firm's id.** `firmStoragePath(firmId, path)` from [lib/tenancy/service-db.ts](lib/tenancy/service-db.ts) is the only way to build one. `getServiceDbForFirm` does NOT prefix for you — it scopes `.from()`, and passes `.storage` through untouched.

- **Buckets:** `files`, `documents`, `receipts`, `templates` are private and service-role-only — no `authenticated` policy on any of them, deliberately. `avatars` and `issuances` are public **on purpose** (profile photos in logged-out chrome; government issuance PDFs are public source material). `chat-attachments` is private too; it went uncreated until `20260928_chat_attachments_bucket.sql`, so every chat attachment failed at upload. Its keys are `<firmId>/chat/<channelId>/…` ([lib/chat/attachment-path.ts](lib/chat/attachment-path.ts)), and the upload confirm, the message POST and the sign route all check a path against the caller's firm and channel before using it. A bucket that is public and isn't one of those two is a leak of everything in it; the probe asserts the set.
- **Reads and writes both go through the app, never the browser's Supabase client.** Uploads are server-minted signed upload URLs, downloads are server-minted signed URLs; a signed URL bypasses RLS by design, which is exactly why a bucket needs no `authenticated` policy — and why one grants far more than it looks like it does.
- **`/api/file-sign` and `/api/files/download` require the firm prefix** and refuse anything outside it. An unprefixed object is therefore not just untidy, it is unreachable through those two routes.
- **Never take an object key from the request and use it.** A client-supplied path handed to `download`/`copy`/`createSignedUrl` under service-role reads whatever it points at, and a client-supplied path written into a row is read back later by code that trusts the row. Re-derive the path from the firm and the entity (`app/api/finance/invoices/upload-signed/route.ts` accepts a slot enum and builds the path itself — that is the pattern to copy), or check it against a server-built prefix before use.
- **Two-phase uploads follow one rule, in one place.** Phase 1 mints the path from the caller's firm and an entity it has just proved ownership of; phase 2 re-derives the same prefix and checks the returned path against it with [lib/storage/upload-path.ts](lib/storage/upload-path.ts) (`checkPathUnder` / `assertPathUnder` / `pathsNotUnder`). It matches at a path-segment boundary — a bare `startsWith` accepts `foo/bar` under prefix `foo/ba` — and rejects `..`/`.` segments, empty segments, backslashes and absolute keys. **A prefix check alone is not enough when the entity id is caller-supplied too**: pass another firm's `deliverableId` and a naive prefix check happily validates a path derived from it, which is why part (1), the ownership read, is not optional. Refuse *before* any existence check so the refusal leaks nothing about the bucket. `app/api/deliverable-file/upload-url/route.ts` and `app/api/admin/finalize/route.ts` are the reference shapes.
- **Known backlog:** `KNOWN_SHARED_PATHS` in [scripts/storage-probe.ts](scripts/storage-probe.ts) lists every call site whose key is still a shared or entity-id path, with a verdict each. The probe fails on a NEW one, so that list can shrink but not grow by accident. The two-phase upload commits are off it as of follow-up 1; what remains is status reports, exhibits, red-team, engagement proposals and signatures.
- **The probe attacks the handlers, not just Storage.** Part 3 of `storage-probe.ts` signs firm B in against a running dev server and performs the real attack — B confirming an upload whose `storagePath` names a firm-A object — against every two-phase commit, each attack paired with a control that must SUCCEED (a broken session makes every refusal look like security). Without `npm run dev` up those checks SKIP loudly; `--require-live` turns the skip into a failure. Add a new two-phase upload, add its attack there.
- **Legacy objects** (~385 in the dev project, imported with the fork) sit outside any firm prefix. They are reported by the probe and never asserted on.

## Realtime, push, email

- Supabase Realtime: the `files` table is in the realtime publication (see migration `20260418_files_realtime.sql`). `components/RecentFilesSection.tsx` listens for `action_taken`/`acted_upon_by_ids` updates. It was `InboxSection` until the email inbox was deleted, which is a name that cost one near-miss; it is now called what the card has always been titled in the UI — **Recent Files**.
- Web push: VAPID keys in env, subscriptions in `push_subscriptions`, send via [lib/push.ts](lib/push.ts). Respect `user_preferences.notify_chat` and friends.
- Transactional email: [lib/email.ts](lib/email.ts) wraps Resend. The daily briefer is `/api/notifications/email-briefer` (cron-gated).
- **Client-facing mail goes out through Resend too, via `sendClientMail`** — billing statements, payment follow-ups, trademark reports. It replaced the Graph `sendMail` path those three routes took, and took `lib/email/mailbox-sender.ts` with it: Graph app-only mail cannot use a Microsoft 365 Group as a send principal, so a firm whose `finance@` was a Group had to nominate a real staff mailbox holding Exchange "Send As" rights and send through that. Resend sends from an address on a verified domain, so the address is simply the address — the operational cost moved to DNS rather than vanishing.
  - **`fromAddress` is never defaulted.** It comes from the firm's own `loadOutboundIdentity(firmId)` ([lib/firm/outbound-identity.ts](lib/firm/outbound-identity.ts)) and a blank one refuses the send: an invoice sent from another tenant's address is also an invoice *replied to* at that address.
  - **It throws `ClientMailError` rather than logging and continuing**, unlike the notification senders beside it in the same file. Every caller has a person waiting to hear whether their client received it, so the routes surface the failure: 503 for a `ClientMailError` (a configuration answer — no key, no from-address, unverified domain), 502 for anything else.
  - These routes **no longer gate on a mail feature key at all.** `graph_mail` is deleted along with the inbound surface it covered, and sending is a platform capability rather than a per-firm integration — the only precondition left is the firm's own from-address, which `sendClientMail` checks itself.

## Locale & timezone

The firm is in the Philippines. Dates render in `en-PH` / `Asia/Manila` in UI code. Server timestamps are stored as UTC; format only at the edge.

- **Calendar days go through [lib/dates.ts](lib/dates.ts)**, which reads everything through `Intl` with an explicit time zone, so the answer is the same on the server and in a browser. `manilaToday()` / `manilaDate(n)` / `manilaMonth()` for today, `toManilaDay(at)` for the day a timestamp falls on (a bare YYYY-MM-DD passes through), `manilaDayStart` / `manilaDayEnd` to filter a timestamptz column by day, `toManilaInstant` before writing a date or zoneless date-time to one, and `addDays` / `addMonths` / `addYears` / `lastDayOfMonth` / `utcCalendarDay` for arithmetic on YYYY-MM-DD values. `toISOString().slice(0, 10)` is the UTC day — yesterday in Manila before 08:00 — and `new Date(x.toLocaleString('en-US', { timeZone: 'Asia/Manila' }))` re-parses a wall clock in the *host* zone (it broke the DTR quick-add before 08:00). An ESLint `no-restricted-syntax` rule rejects both everywhere except `lib/dates.ts`. Don't silence the rule; use the helper that says what you mean.
- `meetings.date_start` / `date_end` and `hearings.date` are timestamptz. A meeting or hearing with no time is stored at Manila midnight (older rows: midnight UTC); `isDateOnly` recognises both.
- **The Hearings and Meetings lists are Calendar's tabs** (`/dashboard/calendar?tab=hearings|meetings`, [lib/calendar/views.ts](lib/calendar/views.ts)); the old list URLs redirect there, and a hearing or meeting still opens at `/dashboard/hearings/<id>` / `/dashboard/meetings/<id>`. A list reads a date window, firm-scoped (`getHearings` / `getMeetings` in [lib/queries/listing.ts](lib/queries/listing.ts)) — by default from 90 days back on, open ahead, so the cards' "past 90 days" counts stay whole; `range=year`, `range=all` or `from`/`to` widen it. Don't read either table whole for a list. `/admin/calendar` and `/liaison/calendar` stay the month calendar.

## Testing & verification

**`npm run verify` is the whole gate set, in order, fail-fast.** Run it before declaring a multi-tenancy change done, and in CI:

| step | script | what it holds |
| --- | --- | --- |
| `verify:types` | `tsc --noEmit` | type safety |
| `verify:test` | `vitest run` | the unit suite |
| `verify:service-role` | `scripts/audit-service-role.ts` | no tenant table read through the raw service-role client off-allowlist |
| `verify:firm-id` | `scripts/audit-firm-id-stamping.ts` | no tenant-table insert/upsert without `firm_id` on a client that doesn't stamp it |
| `verify:ai-gate` | `scripts/audit-ai-gate.ts` | no model client constructed, and no embedding call made, outside `lib/ai/gate.ts` — every AI feature is opt-in per firm |
| `verify:route-auth` | `scripts/audit-route-auth.ts` | no `app/api` handler without an authentication check, off a reasoned allowlist |
| `verify:brand` | `scripts/audit-brand.ts` | no origin-tenant name anywhere in the tracked tree — code, migrations, docs, and the XML inside any bundled DOCX/XLSX. The names come from the untracked `.brand-terms`; without it the check skips loudly |
| `verify:person-shaped` | `scripts/audit-person-shaped.ts` | no short opaque token in a per-person-allocation or string-union position that nobody has named — the half `verify:brand` structurally cannot see |
| `verify:status-literal` | `scripts/audit-status-literals.ts` | no deliverable status spelled as a bare string outside `lib/deliverable-status.ts`, off a counted, reasoned allowlist |
| `verify:rls` | `scripts/rls-probe.ts` | Postgres: two disposable firms, every persona, through PostgREST; plus the catalog-wide `firm_id` refusal sweep and the invoice write path end to end |
| `verify:storage` | `scripts/storage-probe.ts` | Storage: bucket policies, per-firm object isolation, and the shared-path sweep |
| `verify:platform` | `scripts/platform-probe.ts` | the `/platform` operator boundary, through the real HTTP handlers |
| `verify:cron` | `scripts/cron-probe.ts --static-only` | every CRON_SECRET handler fans out per firm |

`npm run lint` is deliberately NOT in the chain: the repo has ~1500 pre-existing `eslint` errors, so wiring it in would make the gate red for reasons no tenancy change caused. Its one load-bearing rule — `no-restricted-imports` on the raw `@/lib/supabase` — is enforced in the chain by `verify:service-role`, which parses the same allowlist out of `eslint.config.mjs`. Lint what you touched (`npx eslint <paths>`) rather than the repo.

`verify:platform`'s handler half needs `npm run dev` up (like `verify:storage`'s part 3): without it those checks SKIP loudly, and `--require-live` turns the skip into a failure. Its database half runs either way.

**Every probe request to the dev server goes through `probeFetch`**
([scripts/probe-fetch.ts](scripts/probe-fetch.ts)), and new ones must too. Node's
global undici dispatcher pools keep-alive sockets; Next's HTTP server retires an
idle one after ~5s; the probes do seconds of database work between requests. Lose
that race on a POST — which undici will not retry for you, being non-idempotent —
and the request goes into a black hole until undici's default `headersTimeout` of
**300 seconds**, then fails the whole chain. It presented exactly once that way,
in storage-probe's handler attack section, and the identical re-run passed with no
code change. (Slow first compilation was the obvious suspect and was wrong: an API
route answers in ~4ms cold, because the proxy redirects before the route compiles.)

`probeFetch` gives every request a 20s deadline and one retry, and the retry is
safe by construction: it fires **only when `fetch` itself throws**, so no response
ever existed to assert on. A Response comes back untouched — a handler that
answers 200 where the probe demands 403 still fails, as it must. Retries are
logged, because a probe that quietly papers over a flaky server is worse than one
that fails. The known trade-off: a retried POST may already have run server-side,
so a side effect can happen twice — acceptable against per-run disposable fixtures,
and it would surface as a loud assertion failure rather than a silent pass.

`npm run verify:live` is the rest of the cron probe — skip visibility and per-firm error isolation against real HTTP handlers. It needs `npm run dev` up (`PROBE_BASE_URL` to point it elsewhere), so it is not in `verify`.

Everything except `verify:types`, `verify:test` and `verify:lint` talks to the dev Supabase project and needs `.env.local`. The three probes provision and tear down their own disposable firms; a crashed run is cleaned up by the next one's opening teardown.

- **`npx tsc --noEmit` is the type-safety net** — run it before declaring a non-trivial change done.
- **Vitest unit suite** — `npm test` (single run; the gate to keep green) and `npm run test:watch`. Config in [vitest.config.ts](vitest.config.ts) (Node env, mirrors the `@/*` alias).
  - **Convention:** colocate `*.test.ts` next to the source file (e.g. [lib/meeting-quorum.test.ts](lib/meeting-quorum.test.ts) beside `lib/meeting-quorum.ts`).
  - **Scope so far (886 tests across 74 files):** the runtime-pure `lib/` surface — `dtr-utils`, `deliverable-status`, `meeting-quorum`, `sanitize-comment`, `corporation-row`, `annexes`, `download-headers`, `firm-domains`, `rate-limit`, `validation` (Zod schemas), `corporation-identity`, `knowledge-click`, `deliverable-actions`, `corporation-deadlines`, `trademark-deadlines`, `platform/firm-issues`, `fleet/manifest` and `fleet/migrations` (the latter also holds the migrations directory and its version map in agreement). Use fake timers (`vi.useFakeTimers`) for any "today"-relative date math.
  - **Not yet covered:** API routes and components need Supabase/session/`next/*` mocking; the remaining `lib/` files (`upload`, `microsoft-graph`, `email`, the SWR/DOM helpers) are network/side-effect-heavy. Worth doing deliberately, but don't let an unattended loop wander into them — keep automated test-writing on mockless `lib/` targets.
- For UI changes, start `npm run dev` and exercise the flow in a browser. Don't claim a UI change works without observing it.

## UI kit

Staff screens are built from [components/ui/](components/ui/), so every page reads as one product. The client portal keeps its own kit in [components/client-ui/](components/client-ui/).

- Colours and shapes live in [components/ui/tone.ts](components/ui/tone.ts): `CARD`, `PILL_TONE` / `TONE_DOT` / `TONE_WASH`, `STATE_CHIP`, `URGENCY_CHIP`, `HEALTH_STYLE`, `ACCENT_TILE`, `BTN_TONE`. Greys are `stone-*` (warm) — not `zinc-*`, `gray-*` or `slate-*`. Palette tokens such as `navy` and `gold` are the app's own chrome, not a firm's brand; a firm's colours reach its documents through `firms.branding`, never through the staff UI.
- Pieces: `PageHeader` for the top of a page, `SectionCard` / `SubjectCard` for sections, `StatusPill` / `MetaChip` / `DueChip` / `IconChip` ([primitives.tsx](components/ui/primitives.tsx)), `Button` (or `buttonClass` / `BTN_*` where an element can't be one), `Modal` for every dialog and `ConfirmDialog` / `confirmAction` to ask before something that can't be taken back, `EmptyState` / `ListEmpty` for nothing-to-show.
- Don't hand-roll a `fixed inset-0` overlay, a local `*Pill` / `*Badge`, or a page `<h1>`: use or extend the kit piece, so a change to it reaches every screen.
- **The sidebar is a short default, grouped by purpose**: the day, Matters, Practice, Draft & research, Me, then the gold Partner group ([lib/nav/pages.ts](lib/nav/pages.ts)). A new page goes into its section as **More-only** (`sidebar: false`) unless people open it most days or it carries a count someone must act on. More (`/dashboard/tools`, and `/admin/more`, `/finance/more`, `/liaison/more` inside those shells; [lib/nav/more.ts](lib/nav/more.ts)) lists every page a role can open and the firm's features allow, and the search bar finds them. Chat opens from the header (`ChatButton`), Settings and Sign out from the avatar menu (`AvatarMenu`), and a count whose page has no sidebar link rolls up onto More. Nothing records which links anyone clicks.
- **Announcing a feature goes through the dashboard's "New for you" card** ([lib/whats-new.ts](lib/whats-new.ts)), not a new banner. A new sidebar page appears there on its own for `NEW_PAGE_DAYS` after its `addedOn`, in its `description`'s words, until the person opens or hides it — and only when their role and their firm's features let them open it. Whether a page was opened or hidden lives in the browser (`hooks/use-page-visits.ts`), never on the server.

## Reactive UI — do not use `router.refresh()` after mutations

The codebase was swept of `router.refresh()` / `window.location.reload()` after edits in May 2026. The expected pattern after a successful mutation is **optimistic local state update**, not a full RSC refresh that re-mounts the page.

**The rule:**

- After a successful `fetch(...)` PATCH/POST/DELETE in a client component, update local `useState` to reflect the change. Do NOT call `router.refresh()`.
- For lists, lift the array to `useState(initialItems)` with a `useEffect` mirror from props, and `setItems((prev) => prev.map/filter/...)` after the API call returns.
- For inline edits on a single field, use either local `useState` + try/catch rollback, or React 19's `useOptimistic` for cleaner revert semantics.

**Cross-component reactivity (multiple siblings on one detail page share the same entity state):**

The deliverable detail page is the canonical reference — see [components/detail/DeliverableShellProvider.tsx](components/detail/DeliverableShellProvider.tsx). It wraps the body in a React Context provider that owns the mutable entity via `useState` + `useOptimistic`. Sibling client components (`EditableStatusPill`, `DeliverableDetailClient`, `DeliverableHeaderBar`, `DeliverableActionRow`) consume `useDeliverable()` to read `item` and call `updateField(field, value)` or `applyAction({ status, currentlyWith })`. An edit in one sibling reflects in all of them without a page flash. Replicate this pattern for other detail pages that have multiple mutating client components sharing entity state.

**Workflow action buttons (status transitions on lists):**

Components like [DeliverableActionButtons](components/DeliverableActionButtons.tsx) take an optional `onActionComplete?: (patch) => void` callback. The detail page wires it to `applyAction()` from the shell context; list views wire it to a `setRows` updater. Follow the same callback pattern when adding new workflow-action components — never call `router.refresh()` inside them.

**Modals that create a row:**

Change `onSuccess: () => void` / `onSaved: () => void` to `onSaved: (created: Row | null) => void`. The API handler returns the new row in the response; the parent appends it locally. See [components/detail/CorporationComplianceTab.tsx](components/detail/CorporationComplianceTab.tsx) `NewComplianceItemModal` for the canonical example.

**Legitimate exceptions — keep `router.refresh()` for these:**

- [components/LoginForm.tsx](components/LoginForm.tsx) — `window.location.href = '/'` after sign-in to ensure the auth cookie is picked up by a full request cycle.

Each of these has an in-source comment explaining why; if you find another case that genuinely needs a layout-level re-evaluation, add a similar comment.

**When server-rendered ancestors stay stale:**

A few places (e.g. detail-page breadcrumbs computed server-side in `DetailShell`, the dashboard's revalidate-30 snapshot) will stay stale after a local edit until the next navigation. This is the accepted trade-off — the local view is correct, and users will see the fresh value on their next nav. Don't reintroduce `router.refresh()` to fix isolated staleness; promote that data into the shell provider instead.

## Page titles

Every page gets a descriptive browser-tab title — don't leave a new route inheriting the bare `Lumilex` default. The root layout ([app/layout.tsx](app/layout.tsx)) defines the template `%s · Lumilex`, so a page only supplies its own short label.

- **List / index pages:** add a static `export const metadata: Metadata = { title: 'Matters' };` (label only — the template appends `· Lumilex`).
- **Detail pages (`[id]` etc.):** add `generateMetadata` that resolves the entity's name via [lib/page-metadata.ts](lib/page-metadata.ts) — `entityTitle({ table, idColumn, id, nameColumn, fallback })` returns the row's name or a generic fallback. The lookup is RLS-scoped (uses the authed client), so a user without access gets the fallback rather than a leaked name. Always pass a sensible `fallback`.
- Both `metadata` and `generateMetadata` only work in **Server Components**. If a page is `'use client'`, the title must live on its parent server layout/page instead.
- Redirect-only stub pages don't need a title.

## Style

- Don't write narrating comments ("// added for X feature", "// removed Y"). The diff already tells that story.
- Don't add backwards-compat shims or feature flags for code that is fully replaced — just delete the old path.
- No new dependencies unless the existing stack genuinely can't do it. We already have docx/xlsx/pdf/zod/swr/recharts/tiptap/sonner — check first.
- Skip `try/catch` walls for impossible cases. Validate at the request boundary (`lib/validation.ts` schemas) and trust internal helpers.
- **No native `<input type="date">` or `<select>` in forms.** They render the browser's default chrome and clash with the rest of the UI. Use [DatePickerInput](components/DatePickerInput.tsx) for dates (emits `YYYY-MM-DD`; the existing `AddTaskModal` / `AddDeliverableModal` / `FileReimbursementModal` etc. all use it) and [CellDropdown](components/admin/CellDropdown.tsx) for single-select dropdowns. Same applies to time pickers — `DatePickerInput` has a `showTime` prop.

## Scripts

Maintenance lives in [scripts/](scripts/), run via `npx tsx scripts/<name>.ts`. Examples: `backfill-*`, `reembed-*`, `seed-guide-*`, `seed-protocols`, `generate-all-summaries`. These need `.env.local` loaded.

**A seed script takes a firm explicitly.** The `firm_id` column defaults are gone, so a script that writes a tenant table without one raises 23502 — and a script that "helpfully" picks a firm is worse. `seed-resolution-templates` and `seed-fee-schedules` show the shape: required `<firmId>` argument, `getServiceDbForFirm`, insert only what is missing.

The Library handbook seeds (`seed-guide-*`, `seed-playbook-*`, `seed-protocols`, `seed-style-guide`) share one front end, [scripts/resource-seed.ts](scripts/resource-seed.ts) — `runSeed(scriptName, resource)`, taking `<firmIdOrSlug> [--force]`. They write handbook pages into `kb_pages` (the `resources` table was folded into it), sanitized like every handbook write. Each script is its content plus that one call; the firm resolution, the scoped client, the firm-derived `author_name` and the leave-what-exists rule live in the helper. Ten copies of that fix is how one of them drifts. Adding a new guide means a new file with a `runSeed` call, not a new client.

**`verify:brand` reads every tracked file and looks inside Office files**
([scripts/audit-brand.ts](scripts/audit-brand.ts)). It used to be a grep over
`app lib components public` and `docs/guides` that skipped binaries, so ten seed
scripts carried the origin firm's name for weeks, and the bundled DOCX templates
carried its logo, staff roster and sign-off past every green run — a DOCX is a
zip, and grep never opened it. Since 2026-11-01 it covers migrations and docs
too, because the whole tree is published. It still checks only for the firm's
*name*, and it cannot read images or PDFs: a screenshot of the origin firm
passes it, and so does a real client's name. Hold seed content and guide images to the rule by hand.

**The names it looks for are not in the tree.** A check that spells out the
name it guards against publishes that name. [scripts/brand-terms.ts](scripts/brand-terms.ts)
reads them from an untracked `.brand-terms` file at the repo root (one term per
line, case-insensitive substring) or from `BRAND_TERMS`; both `verify:brand` and
`render-brand-samples` use it. Without a list the gate prints SKIPPED and passes,
and `--require-terms` makes that a failure. A term must not be a substring of an
ordinary word — `affordance` and `KpiCard` are why two surnames are not on it.

## Deploy

**The one deployment is the public demo.** `lumilex-demo` builds `main` and serves
`demo.lumilex.co` against the test project (`scripts/demo/vercel-setup.sh` links and
configures it; [docs/demo-instance.md](docs/demo-instance.md) is the runbook). So a push
to `main` now reaches a public site — green `verify` before merging, as ever. No firm is
deployed yet. The auto-deploy this section once described belonged to
the origin app, which is a separate codebase and must never receive Lumilex code.

**When it is deployed, it is one Vercel project per firm**, every one building `main`
from this repo, each recorded in [fleet/instances.json](fleet/instances.json).
Platform keys (Anthropic, Voyage, Resend, Firecrawl) are team-level shared variables;
Supabase keys, `CRON_SECRET`, `APP_BASE_URL` and `INTEGRATION_CREDS_KEY` are per
project. A push then deploys the code everywhere at once, but not the schema:
run `npm run fleet:migrate -- --apply` for that. What still has to be settled before
the first firm instance is listed in
[docs/multitenancy-followups.md](docs/multitenancy-followups.md) → "One codebase, one
instance per firm".

**Only `main` builds.** `vercel.json`'s `ignoreCommand` skips every other branch, on
every instance: a preview deployment of a firm's project would run unmerged code against
that firm's database.

Thirteen crons are declared in [vercel.json](vercel.json) — every one of them fans out per firm through `forEachActiveFirm` / `forEachFirmWithFeature`, which `npm run verify:cron` asserts. A new cron path added there without a fan-out turns that gate red.

## Publishing

This repository (`dfrdn/lumilex-dev`) is private; the public one is
`dfrdn/lumilex`, and it never receives this history. `scripts/publish-release.sh`
cuts a release: one commit carrying `origin/main`'s tree on top of the previous
release, pushed to the `public` remote after `verify:brand --require-terms` and
`verify:person-shaped` pass on exactly that tree. Commit messages here are never
published, but every file is, so the de-branding rules hold for the whole tree.
Never add the public repository as `origin`, and never push a branch of this
history to it.

## User guides

End-user documentation lives in [docs/guides/](docs/guides/): comprehensive guides (`README.md`, `common.md`, `lawyer.md`, `finance.md`, `admin.md`, `liaison.md`) plus derived `cheatsheets/` (one printable A4 page each) and `decks/` (Markdown slide decks). **The guide is the source of truth; cheatsheets and decks must never state a fact the guide doesn't.**

- **Any change that adds, removes, or alters a user-facing behavior updates `docs/guides/` in the same PR.** Not a follow-up, not a TODO.
- User-facing = a new route or screen, a changed workflow or status transition, a new or renamed field the user fills in, a changed permission or role gate, a new automatic/background behavior, a new irreversible action.
- Not user-facing = refactors, type changes, internal helper moves, test-only changes, performance work with no behavior change.
- Propagation rule: a guide edit cascades to that role's cheatsheet and deck when it touches a top task, a status enum, an irreversible action, or an automatic behavior. Otherwise the guide edit alone is enough.
- Screenshots: if the change alters a screen listed in [docs/guides/capture/manifest.md](docs/guides/capture/manifest.md), recapture it using the manifest's recorded route/role and [docs/guides/capture/anonymize.js](docs/guides/capture/anonymize.js). The dev server runs against production data — never commit an image that wasn't captured with the anonymizer verified clean, and never commit the generated term list.
- Every guide, cheatsheet, and deck ends with `_Last verified against commit `<sha>` on <YYYY-MM-DD>._` — refresh it when you verify, and only then: the line claims a whole-document re-read, so touching one paragraph is not grounds to move it.
- **The guides are tenant-neutral and `verify:brand` holds them that way.** No firm name, staff name, mailbox, or invoice prefix — teach the *shape* (`PREFIX-YYYY-MM-###`) instead. The screenshot anonymizer takes its staff allowlist and firm mail domains from runtime-seeded globals ([capture/manifest.md](docs/guides/capture/manifest.md) step 4), never from baked-in constants, and unseeded means "scrub more" rather than "scrub less". The gate reads text only: `docs/guides/pdf/` holds generated renders, so regenerate them per [docs/guides/pdf/README.md](docs/guides/pdf/README.md) rather than editing them.
- Use the `/update-guides` skill to run this whole flow over a diff. Full regeneration (after a redesign): re-run [docs/prompts/lumilex-user-guides.md](docs/prompts/lumilex-user-guides.md).
