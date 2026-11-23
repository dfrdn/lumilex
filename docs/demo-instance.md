# The public demo — demo.lumilex.co

A fictional firm, **Lumilex & Partners**, that anyone can sign in to with one
click, as a partner, associate, finance, office admin or liaison. Nothing a
visitor does reaches a real person, and everything is put back at 03:00 Manila
every night. The plan and its reasoning are in
[multitenancy-followups.md](multitenancy-followups.md) → "The demo instance";
the editing rules are in CLAUDE.md → "The public demo". This file is the
runbook.

## Where it runs

| | |
| --- | --- |
| Supabase | the **test** project, `jmwcsldskeycpgqtbcyx`, beside the dev firm and whatever the probes are provisioning. The probes only ever delete their own `probe-*` firms. |
| Vercel | `lumilex-demo`, building `main` like any firm's instance would |
| Host | `demo.lumilex.co` — the demo firm's primary domain and the deployment's `APP_BASE_URL` |
| Firm config | [scripts/demo/firm.json](../scripts/demo/firm.json), slug `demo` |
| AI | every AI consent on; capped at 40 calls an hour and 150 a Manila day (`settings.aiLimits`) |
| Mail, SharePoint, push | none — no `RESEND_API_KEY`, `MS_*` or VAPID keys on the project |

## Building it from nothing

Every script refuses any project but the one `fleet/instances.json` lists for
`demo.lumilex.co`, and any firm but the one `firm.json` names. The destructive
ones also refuse a firm not marked `settings.demo.enabled`.

1. **Firm and content.** `npx tsx scripts/demo/build.ts` provisions the firm
   through `provisionFirm()`, marks it the demo, fills it (staff, clients,
   matters, deliverables with version files, hearings, time, invoices,
   corporations, trademarks, errands, chat — [content.ts](../scripts/demo/content.ts)),
   registers the five personas and switches on its integrations. No model is
   called. To start over: `npx tsx scripts/demo/wipe.ts --yes`.
2. **Library.** The handbook seeds, each with the firm slug:
   `npx tsx scripts/seed-guide-lawyers.ts demo` and the other `seed-guide-*`,
   `seed-playbook-*`, `seed-protocols` and `seed-style-guide` scripts, and
   `npx tsx scripts/seed-evidence-rules.ts --firm demo`. Then the Rules of
   Court: `npx tsx scripts/import-rules-of-court.ts demo` (it embeds every
   section, so it needs `VOYAGE_API_KEY`).
3. **AI pass**, with `npm run dev` up: `npx tsx scripts/demo/ai-pass.ts`. It
   drives the app's own per-firm cron handlers — file analyses, matter
   summaries and health, embeddings — until nothing is pending, then distils
   the Library pages and fills document text. The ceiling must be off while it
   runs (`npx tsx scripts/demo/cap-ai.ts --off`); it refuses otherwise.
4. **Cap AI.** `npx tsx scripts/demo/cap-ai.ts`.
5. **Snapshot.** In the SQL editor (or the Supabase MCP):
   `select demo_snapshot.invoke('snapshot');` — the edge function copies every
   demo row into the `demo_snapshot` schema and every seeded object into the
   private `demo-golden` bucket. Check it in `net._http_response` or the
   function's logs.

The reset machinery itself is installed once, by running
[scripts/demo/reset.sql](../scripts/demo/reset.sql) on the project and
deploying [supabase/functions/demo-reset](../supabase/functions/demo-reset/index.ts)
with JWT verification off. Both are already on `jmwcsldskeycpgqtbcyx`.
**Neither is a migration, and neither may become one**: a function that
deletes and rewrites a whole firm must never reach a firm's instance.

## The nightly reset

pg_cron job `demo-reset`, `0 19 * * *` UTC (03:00 Manila), runs
`demo_snapshot.invoke('reset')`, which calls the edge function with a secret
it reads from the Vault (`demo_reset_secret`; the function reads the same entry
to check it). The function:

1. `demo_snapshot.restore(firm)` — one transaction with triggers off: delete
   the firm's rows in every tenant table, insert the snapshot back with every
   `date` and `timestamp` moved forward by the days since the snapshot, and
   nudge hearings, meetings, deadlines, tasks and errands off weekends.
   `ai_usage_hourly` is left alone, so a reset never refills the allowance.
2. Puts storage back to the snapshot's manifest: any seeded object a visitor
   deleted is copied back from `demo-golden`, anything a visitor uploaded
   under the firm's prefix is removed.

Run it by hand with `select demo_snapshot.invoke('reset');`.

**Retake the snapshot after any migration that changes a seeded table.**
Restore tolerates drift — a column added since takes its default, a dropped
table is skipped — but a new NOT NULL column without a default fails the
restore, and the demo stays as visitors left it until someone retakes it.

## Deploying

`bash scripts/demo/vercel-setup.sh` (your Vercel CLI login) links the project
to this repo, sets its variables from `.env.local` without printing them,
sets `LUMILEX_INSTANCE_ROLE=demo` on production only, removes the August
demo's leftovers and adds the domain. Then, at GoDaddy (lumilex.co's DNS):
`CNAME demo → cname.vercel-dns.com`. After that, every push to `main` deploys
the demo.

**`CRON_SECRET` on the deployment must equal Vault's `cron_secret` on the test
project.** The database's webhooks (`call_app_api` / `call_app_api_post`, fired
by the file-upload and deliverable triggers) send Vault's value to Vault's
`app_base_url`, which is this deployment. When the two differ, every webhook is
refused with 401 and nothing says so: uploads and filings simply never get
analysed. Check with
`select status_code, count(*) from net._http_response group by 1;` — a 401
column is this. To rotate, set both to one new value, then redeploy (an env
change reaches only new deployments):

1. `DEMO_CRON_SECRET=$(openssl rand -hex 32) bash scripts/demo/vercel-setup.sh`,
   or `vercel env add CRON_SECRET production` on its own.
2. On the test project:
   `select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<the value>');`
3. `vercel redeploy <current production URL> --scope dfrdns-projects`.

The script leaves `CRON_SECRET` alone without `DEMO_CRON_SECRET`, so a re-run
for any other reason no longer breaks the webhooks.

For `/platform` on the demo, create an operator on the test project:
`npx tsx scripts/bootstrap-platform-operator.ts <email> <password>`.

## Checking it

`npx tsx scripts/demo-probe.ts` with a dev server in demo mode (the "Demo Dev
Server" launch config, or `LUMILEX_INSTANCE_ROLE=demo npm run dev`;
`PROBE_BASE_URL` if it is not on port 3000). It signs in through the real
handler on `demo.localhost` and `localhost`, checks each refusal below and
pairs it with a control that must succeed. To look around yourself, open
`http://demo.localhost:3000` on the same server.

## What a visitor cannot do

The sign-in, and the refusals in [lib/demo/guard.ts](../lib/demo/guard.ts):

- A visitor first asks for access: name, work email and position, from
  lumilex.co/demo or the demo's login page. The request is stored in
  `demo_access_requests` (read them with
  `select * from demo_access_requests order by created_at desc` on the test
  project) and its id is set as the `lumilex_demo_access` cookie, good for 30
  days. Without that cookie the one-click link `/api/auth/demo?as=<role>` lands
  on the form.
- Signing in then needs all three of
  `LUMILEX_INSTANCE_ROLE=demo`, the host's firm marked `settings.demo.enabled`,
  and the role registered in `settings.demo.personas` to an active, non
  super_user staff row with a login. A refusal lands on the plain login page.
- Refused for the demo firm: creating or editing user accounts, setting or
  changing a password, inviting, removing or re-inviting portal users, editing
  rule sets and other global reference tables, and changing profile photos
  (the `avatars` bucket is public).
- Every model call is counted against the ceiling; past it, AI routes answer
  429 with "This workspace has used its AI allowance for now."

## Known gaps

- Uploads are not size-capped beyond what the app already enforces.
- Visitors share one firm; two people in the demo at once see each other's
  edits until the reset.
- The demo firm shares the test project, so it is migrated by the same
  `fleet:migrate` run and rides every schema change there first — the canary
  the plan wanted, without its own project.
