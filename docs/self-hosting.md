# Self-hosting Lumilex

Lumilex runs on a Supabase database and a Next.js app. You can run both
yourself: on your own machine to try it, or on hosted Supabase and any Node
host for a firm to use. One instance serves one firm. Each firm gets its own
database and its own deployment, all built from this repository.

Lumilex is licensed under the [GNU AGPL v3](../LICENSE). Running it for your
own firm needs nothing more. If you modify it and let other people use your
version over a network, offer them your source as well.

If you would rather not run it yourself, the people who build Lumilex host
and support instances for firms. See [lumilex.co](https://lumilex.co).

## What you need

| | For a local trial | For a firm in production |
| --- | --- | --- |
| Node.js | 22 (20 works for the app) | 22 |
| Docker | yes, for the local Supabase stack | no |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | yes | for `db:bootstrap` only if you script it |
| A Supabase project | no, the local stack is one | hosted or self-hosted Supabase |
| A Node host | no | Vercel, or any host that runs `next start` |

Everything else is optional. Without it, the feature it powers is simply
unavailable:

| Service | Environment variables | What it turns on |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | Document analysis, drafting, Red Team, the assistant, portal chat |
| Voyage AI | `VOYAGE_API_KEY` | Semantic search and the drafting studio's grounding |
| Resend | `RESEND_API_KEY` | Outbound mail: billing statements, notifications, the daily briefer |
| Firecrawl | `FIRECRAWL_API_KEY` | Government issuances (also needs Anthropic) |
| Web push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push notifications |
| Microsoft 365 | per firm, on `/platform` | SharePoint mirroring and Word-to-PDF conversion |

Having a key is not the same as switching a feature on. Every AI feature is
also off for a firm until the firm opts in on `/platform`, because each one
sends the firm's documents to a third party. The keys only make the opt-in
possible.

## Try it on your machine

```bash
npm install
npm run setup:local
npm run dev
```

`setup:local` does the whole first-time setup, and is safe to run again:

1. Starts the local Supabase stack (`supabase start`). The first start
   downloads the images.
2. Writes `.env.local` for that stack, with a fresh `CRON_SECRET` and
   `INTEGRATION_CREDS_KEY`. An existing `.env.local` is used, never replaced.
3. Builds the database, if it is empty (see [the database](#the-database)).
4. Provisions a firm from
   [`scripts/self-host/firm.example.json`](../scripts/self-host/firm.example.json)
   and prints its first admin's password once.
5. With `--operator you@example.com`, creates a platform operator for
   `/platform` and prints that password once too.

Then open <http://localhost:3000> and sign in as the admin it printed. Mail the
stack sends lands in Mailpit at <http://127.0.0.1:54324>. Supabase Studio is at
<http://127.0.0.1:54323>.

To set up your own firm instead of the example, copy the example config, edit
it, and pass it in: `npm run setup:local -- --firm my-firm.json`. Every field
is described in [`lib/provisioning/config.ts`](../lib/provisioning/config.ts).
Running it again with the same file changes nothing that already exists.

The setup output lists what the firm still needs before it can bill:
- bank details;
- billing rates;
- prices on the fee schedules;
- the features it uses;
- its logo and monogram.

These are deliberately left blank rather than filled with someone else's
values.

## Run it for a firm

### 1. A database

Create an empty Supabase project. Then build it, from a checkout of this
repository:

```bash
npm run db:bootstrap -- \
  --db-url "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" \
  --app-url https://lumilex.your-firm.ph \
  --cron-secret "<the CRON_SECRET you will give the app>"
```

`--app-url` is where the database reaches the app: three triggers call back
into it. `--cron-secret` must be the same value as the app's `CRON_SECRET`.

### 2. The app

Deploy the repository as a Next.js app. On Vercel, import it as a new project.
Elsewhere, run `npm run build` and `npm start`. Set these variables:

| Variable | Value |
| --- | --- |
| `APP_BASE_URL` | The app's own URL, e.g. `https://lumilex.your-firm.ph` |
| `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` | The project's API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The project's service-role (secret) key |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key |
| `CRON_SECRET` | `openssl rand -hex 32`. The same value you gave `db:bootstrap` |
| `INTEGRATION_CREDS_KEY` | `openssl rand -base64 32`. Unique to this instance, never shared or reused |

Then add whichever optional keys you want from the table above.
[`.env.local.example`](../.env.local.example) lists all of them.

### 3. The firm

From your checkout, with `.env.local` pointing at the new project:

```bash
npx tsx scripts/provision-firm.ts my-firm.json
npx tsx scripts/bootstrap-platform-operator.ts you@your-firm.ph '<a strong password>' "Your Name"
```

Set the config's `primaryDomain` to the firm's hostname: sign-in shows the
firm's name and colours on that host. You can also provision firms from
`/platform/firms/new` once an operator exists.

### 4. Scheduled jobs

On Vercel, the crons in [`vercel.json`](../vercel.json) run by themselves.
Elsewhere, call each path on its schedule with
`Authorization: Bearer <CRON_SECRET>`:

| Schedule (UTC) | Path |
| --- | --- |
| `*/3 * * * *` | `/api/admin/sharepoint-backfill` |
| `*/5 * * * *` | `/api/file-analysis/backfill` |
| `*/5 * * * *` | `/api/cron/subject-status` |
| `30 */6 * * *` | `/api/matter-health/refresh-stale?limit=40` |
| `0 2 * * *` | `/api/matters/auto-archive` |
| `0 3 * * *` | `/api/cron/cleanup-generated-docs` |
| `0 17 * * *` | `/api/cron/firm-expense-recurring` |
| `0 19 * * *` | `/api/cron/corporate-obligations` |
| `0 21 * * *` | `/api/cron/issuances-scrape` |
| `45 21 * * *` | `/api/notifications/generate` |
| `0 22 * * *` | `/api/matter-summary/refresh-stale?limit=20` |
| `0 22 * * 0-4` | `/api/notifications/email-briefer` |
| `0 23 * * *` | `/api/sla/evaluate` |

Each job skips any firm that has not switched its feature on.

## The database

The schema is a baseline plus a list of migrations in
[`supabase/migrations/`](../supabase/migrations/). They must run in the order
given by [`supabase/migration-versions.json`](../supabase/migration-versions.json),
not by filename. That is why `supabase db push` and `supabase db reset` are
switched off for them in [`supabase/config.toml`](../supabase/config.toml), and
why `db:bootstrap` exists.

`db:bootstrap` builds an empty database:
1. It replays every migration in that order and records each one in the
   ledger Supabase uses (`supabase_migrations.schema_migrations`).
2. It puts the two secrets the triggers need into the database's Vault.
3. It removes a development firm the early migrations create.

It refuses a database that already has migrations.

To update an instance after pulling new code, take a backup, then run:

```bash
npm run db:migrate -- --db-url "<connection string>"            # what is pending
npm run db:migrate -- --db-url "<connection string>" --apply    # apply it
```

It applies only what the ledger is missing, in order. It stops at the first
failure, leaving the database one whole migration short rather than half-way
through one. It refuses to run if the ledger and this checkout disagree.

## Checking an instance

`npm run verify` runs the full set of checks:
- type and unit tests;
- static audits that keep the tenancy, AI and authentication rules from
  slipping;
- probes that sign in as every kind of user and try to cross firm
  boundaries.

**Run the probes only against a throwaway database, never one holding a
firm's data.** They create and delete firms, users and files. The local stack
is the right place:

```bash
supabase db reset --no-seed && npm run setup:local   # a fresh local instance
npm run dev                                          # in one terminal
npm run verify                                       # in another
```

A freshly bootstrapped instance passes every probe. That was last checked on
2026-11-01.

## Security notes

- **Sign-up is off.** Every account is created by an admin, by provisioning,
  or by `bootstrap-platform-operator`. Keep it off.
- **`INTEGRATION_CREDS_KEY` seals each firm's integration secrets.** Keep it
  per instance and out of version control. Rotating it makes every sealed
  credential unreadable, so re-enter them after a rotation.
- **The service-role key and the database password bypass every access
  rule.** They belong in the app's environment and your password manager,
  nowhere else.
- **The demo files are not for an instance holding real data.** The demo
  reset (`scripts/demo/`, `supabase/functions/demo-reset`) deletes and
  rewrites a whole firm. Never install it next to real data.
