# Lumilex User Guides

**Lumilex** is your firm's practice-management system — the single place where the firm's matters, court deadlines, document drafting and review, time records, billing, client portal, chat, and liaison errands live. It is the system of record: if it isn't in Lumilex, it didn't happen. Everything renders in Philippine time and pesos, and a lot of it happens automatically — AI matter briefs, document analysis, court-mail triage, deadline reminders — which is exactly why these guides exist: so you know what the system does for you and what it expects from you.

## The guides

Three tiers per role, for three different moments:

- **Guide** — read once when you join; consult when stuck. The single source of truth.
- **Cheatsheet** — one printable A4 page for beside your monitor.
- **Deck** — slides for a training session or orientation.

| Who you are | Guide | Cheatsheet | Deck |
|---|---|---|---|
| Everyone (shared basics) | [The Basics](common.md) | [common](cheatsheets/common.md) | [Firm-wide overview](decks/overview.md) |
| Lawyer or Partner | [lawyer.md](lawyer.md) | [lawyer](cheatsheets/lawyer.md) | [lawyer deck](decks/lawyer.md) |
| Finance | [finance.md](finance.md) | [finance](cheatsheets/finance.md) | [finance deck](decks/finance.md) |
| Admin (secretaries, paralegals) | [admin.md](admin.md) | [admin](cheatsheets/admin.md) | [admin deck](decks/admin.md) |
| Liaison Officer or Chief | [liaison.md](liaison.md) | [liaison](cheatsheets/liaison.md) | [liaison deck](decks/liaison.md) |

Partner-only material is inside the lawyer guide, clearly marked; chief-only material is inside the liaison guide.

> **A note on optional features.** Lumilex serves more than one firm, and some capabilities are enabled per firm — the client portal, push notifications, SharePoint filing, Word-to-PDF conversion, and the issuances library. **Every AI feature is additionally off by default**, each behind its own switch: document analysis, Knowledge search, the assistant, the Drafting Studio, Affidavit Review, Red Team, and the AI answers clients get in the portal. These guides describe the full system; a firm that doesn't have one of those simply won't see it. See [The Basics](common.md) for the same note in context.

Every document is also rendered as a print-ready PDF in [pdf/](pdf/README.md) — guides for reading, one-page cheatsheets for printing, decks with speaker notes inlined. The Markdown stays the source of truth; regenerate PDFs after editing (instructions in that folder).

## The six workflow maps

The most useful part of these guides is how features feed each other. Six end-to-end chains, each with a diagram:

| Chain | Where |
|---|---|
| Matter lifecycle (intake → work → closure) | [lawyer.md](lawyer.md#how-a-matter-flows-through-the-firm) |
| Work product (draft → review → finalize → filed → knowledge) | [lawyer.md](lawyer.md#how-work-product-gets-made) |
| Time to money (DTR → review → invoice → payment) | [finance.md](finance.md#the-money-pipeline) |
| The errand loop (assign → complete → two ledgers) | [liaison.md](liaison.md#the-errand-loop) |
| Documents (upload → analysis → search → SharePoint) | [common.md](common.md#how-a-document-flows-through-the-system) |
| Communication (notifications → push, briefer, calendar feed) | [common.md](common.md#how-communication-reaches-you) |

## Feature areas by role

✓ = works there daily · ○ = can reach it (view, or via another area) · blank = no access

| Feature area | Lawyer | Partner | Finance | Admin | Liaison | Chief Liaison |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard and its widgets | ✓ | ✓ | ○ | ○ | | |
| Matters, deliverables, hearings, filings | ✓ | ✓ | ○ | ○ | | |
| DTR (time logging) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Leave / reimbursements / feedback | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Chat, notifications, search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Drafting Studio, Affidavit Review, Red Team, Document Generator | ✓ | ✓ | ○ | ○ | | |
| Search, Library & Jurisprudence | ✓ | ✓ | ✓ | ✓ | | |
| Cases, Trademarks & Corporations | ✓ | ✓ | ○ | ○ | | |
| Prospects & intake | | ✓ | | ✓ | | |
| Partner analytics, approvals | | ✓ | | | | |
| Billing review & bundle approval | | ✓* | ✓ | | | |
| Invoices, receivables, payments, deposits | | | ✓ | | | |
| Expenses, reimbursements admin, tariffs | | | ✓ | | | |
| Database tables, import, audit log | | | ✓ | ✓ | | |
| Finalize, e-signatures | | | | ✓ | | |
| Portal users & previews | | ✓ | | ✓ | | |
| Errands (own) | | | | | ✓ | ✓ |
| Errand assignment & command center | | | | ✓ | | ✓ |
| Liaison schedule (read-only) | | ✓ | ✓ | ✓ | | ✓ |
| Client portal | *clients only* | | | | | |

\* Any partner can review billing bundles; only the managing partner approves them. A `super_user` role exists as a developer escape hatch that passes every check — see the [admin guide](admin.md).

## Screenshots

Guide screenshots are captured from a development copy of the app with all client data anonymized — client names, matter titles, amounts, and case numbers in images are realistic fakes, consistent across every screenshot. The capture tooling and per-image regeneration instructions live in [capture/](capture/manifest.md).

## For maintainers

These guides are kept current by the editing contract in the repository's `CLAUDE.md` (**User guides** section): any user-facing change ships with a guide update in the same PR, and the `/update-guides` skill automates the classification, propagation to cheatsheets and decks, and screenshot recapture. Every document footer records the commit it was last verified against — `git log <that-sha>..HEAD -- app/` shows what has shipped since.

Incremental updates are right for a feature. After a large refactor or redesign, a **full regeneration** is available instead: re-run the original authoring prompt preserved at [docs/prompts/lumilex-user-guides.md](../prompts/lumilex-user-guides.md).

---

_Last verified against commit `e3ebe1c` on 2026-07-21._
