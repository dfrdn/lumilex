# Lumilex

Practice management for Philippine law firms: matters and deliverables,
companies, trademarks and cases, time and billing, a firm library, chat, a
client portal, and opt-in AI.

One instance serves one firm. Each firm runs on its own database and its own
deployment, all built from this repository.

- **Try it:** [demo.lumilex.co](https://demo.lumilex.co) signs you in to a
  fictional firm as a partner, associate, finance officer, office admin or
  liaison. It resets every night.
- **Run it yourself:** [docs/self-hosting.md](docs/self-hosting.md).
- **Have it run for you:** [lumilex.co](https://lumilex.co).

## What it does

| Area | What's in it |
| --- | --- |
| **Matters and deliverables** | Matters with their team, fee terms and activity; a deliverable pipeline (drafting → review → filing) with versioned files, comments and a status board; tasks, hearings and meetings; court-rule deadline chains with Philippine holidays |
| **Subjects** | Companies, trademarks, cases and people, each with its own record and lifecycle, linked to the matters that cover them. Compliance calendars and stored status for companies, deadlines and office actions for marks, proceedings for cases |
| **Time and billing** | Daily time records, monthly and off-cycle invoices with partner review, receivables and payments, expenses and reimbursements, fee schedules, profitability |
| **Library and search** | The firm handbook, pages distilled from matters, and the Rules of Court in one library; search that pairs keyword matches with semantic results, narrowed to what the viewer may open |
| **Communication** | Firm chat with matter channels, push and email notifications, a daily briefer, and a personal calendar feed for Outlook, Google or Apple Calendar |
| **Client portal** | Clients see their matters, finished work, invoices and the companies and marks the firm chooses to show them. Off by default |
| **AI (opt-in per firm)** | Document analysis, matter briefs, drafting, Red Team review of pleadings, a staff assistant, and portal chat. Each feature stays off until the firm switches it on |
| **Platform** | `/platform`, where an operator provisions firms and sets their branding, features, credentials and invoice details |

Firms differ by configuration, not by fork: branding, letterhead design,
features, integrations and invoice settings all live in the database and are
edited on `/platform`.

## Roles

| Role | Lands on | Works on |
| --- | --- | --- |
| `lawyer` | `/dashboard` | Their matters, deliverables, time, calendar and chat |
| `partner` | `/dashboard` | Everything a lawyer does, plus analytics, review and client management |
| `admin` | `/admin` | Records, users, templates, integrations, the audit log |
| `finance` | `/finance` | Invoices, receivables, expenses, payroll costs, profitability |
| `chief_liaison_officer` | `/liaison` | The liaison team's errands and schedule |
| `liaison_officer` | `/liaison/my-errands` | Their own errands |
| `super_user` | `/dashboard` | Every role's pages, for development |

Clients sign in to `/portal`, and platform operators to `/platform`. Both are
separate kinds of account, not team roles.

## Stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind CSS 4**
- **Supabase**: Postgres with row-level security, Auth, Storage and Realtime
- **Anthropic Claude** and **Voyage AI**, both optional and gated per firm
- **Resend** for mail, **web-push** for notifications
- **Microsoft Graph**, optional and per firm, for SharePoint mirroring and
  Word-to-PDF conversion
- **docx**, **pdfkit**, **pdf-lib**, **exceljs** and **Tiptap** for documents

## Getting started

You need Node.js 22, Docker and the
[Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
npm run setup:local   # local Supabase stack, .env.local, database, a starter firm
npm run dev
```

Open <http://localhost:3000> and sign in as the admin that `setup:local`
printed.

[docs/self-hosting.md](docs/self-hosting.md) covers the rest: running an
instance for a firm on hosted Supabase, every environment variable and the
feature it turns on, updating a database with `npm run db:migrate`, and the
scheduled jobs.

## Repository layout

```
app/            Pages and API routes: dashboard, admin, finance, liaison,
                portal, platform, chat
components/     UI; components/ui is the shared kit
lib/            Domain logic, tenancy, AI gate, document generation
supabase/       Baseline schema, migrations and their version map
scripts/        Setup, probes, imports and maintenance (npx tsx scripts/<name>.ts)
docs/           Self-hosting, user guides, design notes
fleet/          The instances this codebase is deployed to
```

## Development

`npm run verify` runs every gate in order: types, unit tests, static audits
(service-role use, `firm_id` stamping, the AI gate, route authentication,
branding, status literals) and probes of row-level security, storage, the
operator surface and the crons against a test database.

[CLAUDE.md](CLAUDE.md) is the editing contract: how tenancy, security, the AI
gate and migrations are meant to work, and why. Read it before a change that
touches the database or a firm's data.

User guides for each role are in [docs/guides/](docs/guides/).

## Contributing and security

Issues and pull requests are welcome. This repository is published from the
maintainers' working tree as release snapshots, so an accepted pull request
arrives in the next release rather than as a merge.

Please report security problems privately, through GitHub's
[private vulnerability reporting](https://github.com/dfrdn/lumilex/security/advisories/new),
not in a public issue.

## License

Copyright © 2026 dfrdn.

Lumilex is free software, licensed under the
[GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`).
You may run, study, change and share it, including running it for your own
firm. If you run a modified version for other people over a network, you must
offer those people its source code, under the same licence.

It comes with no warranty. See [LICENSE](LICENSE) for the full terms.
