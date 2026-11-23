# Prompt: Generate the Lumilex user guides

Copy everything below the line into a fresh Claude Code session in this repo.

---

Study this codebase and write a comprehensive set of **end-user guides for Lumilex**, one per role. These are for the people who use the app daily at a Philippine law firm — not for developers. Nobody reading them should need to know what Supabase or RLS is.

## Deliverables

Three tiers of documentation for each of four roles, all under `docs/guides/`. The tiers serve different moments: the guide is read once during onboarding and consulted when stuck, the cheatsheet sits pinned next to the monitor, the deck is projected during a training session.

### Tier 1 — comprehensive guides (`docs/guides/`)

- `README.md` — index; one-paragraph "what Lumilex is", who each guide is for, links to all three tiers per role, and a table of every feature area mapped to the roles that can reach it.
- `common.md` — the cross-cutting chapter every role needs: signing in, clock-in/attendance gate, the dashboard, notifications (tiers, For you / FYI / All, muting), chat and @mentions, comments and reactions, file upload/versioning, search, the Telegram bot, the client portal (what clients see), settings and preferences.
- `lawyer.md` — covers `lawyer` and `partner`. Call out clearly which sections are partner-only.
- `finance.md`
- `admin.md`
- `liaison.md` — covers `liaison_officer` and `chief_liaison_officer`; mark chief-only sections.

Each role guide stands alone for daily work and links to `common.md` rather than repeating it.

### Tier 2 — cheatsheets (`docs/guides/cheatsheets/`)

`lawyer.md`, `finance.md`, `admin.md`, `liaison.md` — one per role, plus `common.md` for the shared basics.

- **One page each.** Hard constraint: must print legibly on a single sheet of A4. If it doesn't fit, cut content — do not shrink the layout.
- Dense tables and short lists, not prose. No paragraphs longer than two lines.
- Content: the 8–12 tasks that role does most often, each as a one-line path + action (e.g. "Log time → `/dashboard/my-dtr` → Add Entry → date, matter, hours, description"); the status enums that role touches with what each means; the irreversible actions with a warning marker; what happens automatically and when; where to go when something looks wrong.
- No diagrams, no screenshots, no conceptual explanation. A cheatsheet is for someone who already read the guide and forgot a step.
- Head each one with a link back to its full guide.

### Tier 3 — presentation decks (`docs/guides/decks/`)

`lawyer.md`, `finance.md`, `admin.md`, `liaison.md`, plus `overview.md` — a firm-wide 10–15 slide deck introducing Lumilex to everyone regardless of role, suitable for a kickoff or a new-hire orientation.

Author these as **Markdown slide decks** — slides separated by `---`, one idea per slide, so they live in the repo and diff cleanly. Structure each role deck as:

1. Title + who this is for
2. Where you land when you sign in, and why
3. Your daily loop (3–5 slides walking the most common workflow end to end)
4. The interaction chains that matter to this role — one Mermaid diagram per slide, from Phase 2
5. What the system does for you automatically
6. The things you cannot undo
7. Where to get help

Deck writing rules:

- **Max ~40 words of body text per slide.** A slide is a talking point, not a paragraph. If a slide needs more, split it.
- Lead each slide with a bolded one-sentence takeaway, then at most 4 supporting bullets.
- Use speaker notes (an `<!-- notes: ... -->` comment under the slide) for the detail a presenter would say out loud. This is where the nuance from the full guide goes.
- Diagrams carry the weight — prefer a Mermaid flow over a bulleted list wherever a process is being explained.
- 20–30 slides per role deck.

If the user wants rendered `.pptx` files afterward, the `pptx` skill can build them from these Markdown sources — but the Markdown is the source of truth, so write it to stand on its own.

## Phase 1 — study before writing

Do not start drafting until you have actually read the code. Cover at minimum:

1. **Roles and gating.** Read `proxy.ts` end to end — it is the authoritative map of which role reaches which top-level surface. Note that `super_user` passes every check and is a developer escape hatch (mention it only in the admin guide, briefly). Cross-check against role conditionals inside page components, since some surfaces are reachable but render differently per role.
2. **Every user-facing route.** Walk `app/dashboard/*`, `app/finance/*`, `app/admin/*`, `app/liaison/*`, `app/portal/*`. For each, read the page and its main client component to learn what the screen actually does, what actions exist, and what state changes result.
3. **The domain model.** Use the Supabase MCP (`list_tables`) plus `supabase/schema.sql` and `supabase/migrations/` to understand the entities — matters, matter groups, deliverables, filings, hearings, meetings, tasks, files, clients, corporations, trademarks, prospects, DTR, expenses, reimbursements, invoices, payments, deposits, errands, evaluations. Note lifecycle/status enums (`lib/deliverable-status.ts`, `lib/enum-options.ts`) because status transitions are the backbone of most workflows.
4. **Automation the user will notice.** Read `lib/ai/*` (matter briefs, exec summaries, health, file analysis, knowledge search, drafting/grounding, affidavit review, proofread, status reports, style profiles), `lib/notifications.ts`, `lib/juris.ts`, `lib/email-sync.ts` + `app/api/cron/email-autopilot`, `lib/sharepoint-sync.ts`, `lib/telegram/*`, and the cron endpoints. Users need to know what happens *without* them clicking anything, and how long it takes.
5. **Integrations.** Outlook/SharePoint via Microsoft Graph, Resend email, web push, juris.ph, the client portal. Explain each as a user-visible behavior, not an API.
6. **Existing docs.** Read `README.md`, `CLAUDE.md`, and anything already in `docs/` so the guides agree with them.

Use parallel subagents for the survey phase — split by surface area (dashboard, finance, admin, liaison, AI/automation, DB model) and have each return a structured inventory. Then synthesize yourself.

## Phase 2 — map the interactions

Before writing role guides, build the connective tissue. The most valuable part of this documentation is **how features feed each other**, so make that explicit with end-to-end narratives. At minimum trace:

- **Matter lifecycle:** client/prospect intake → conflict check → matter creation → assignment → deliverables and filings → hearings/meetings → status reports to the client → closure. Where do AI briefs, exec summaries, and matter health fit?
- **Work product:** deliverable created → drafted (drafting studio, grounding, templates) → versions and comments → affidavit review → finalize → filed version → document analysis → knowledge base.
- **Time to money:** DTR entries → finance DTR review and revisions → billing bundle → expenses and reimbursements (billable vs. payback) → waive/exclude decisions → invoice generation → VAT → send → payment/deposit → receivables and running balance → profitability and cash flow.
- **Liaison loop:** errand request raised on a matter → assignment → transportation tariff (internal vs. external rate) → completion → reimbursement ledger + client-billable expense.
- **Documents:** upload → storage → SharePoint mirroring → embeddings → knowledge search → citation resolution via juris.ph.
- **Communication:** inbound email sync → autopilot classification → linking to a matter → notification tiers → chat/mentions → push and the daily email briefer.

Render each as a short numbered narrative plus a Mermaid diagram. Put the shared ones in `common.md` or `README.md` and reference them from the role guides.

## Phase 3 — write the comprehensive guides first

Write all of Tier 1 before starting Tier 2 or Tier 3. **The comprehensive guide is the single source of truth; the cheatsheet and the deck are derived from it and must not introduce a single fact that isn't in it.** If while writing the cheatsheet you find yourself wanting to state something the guide doesn't cover, go fix the guide first, then derive.

This ordering is the whole point — three independently-written documents about the same software will drift within a week, and a wrong cheatsheet is worse than no cheatsheet because it's the one people actually trust.

### Writing standards

- **Task-oriented.** Organize around "what I'm trying to get done," not around the nav bar. Every feature section answers: what it's for, when to use it, step-by-step how, what happens downstream, and what commonly goes wrong.
- **Ground every claim in code.** If you cannot find the behavior in the codebase, do not document it. Where behavior is genuinely ambiguous, add a `> **Verify:**` callout rather than guessing. Never describe a feature that does not exist yet.
- **Flag the automatic.** Anything that happens on a trigger, a cron, or an AI job gets an explicit "this happens on its own" note with its cadence, so users don't duplicate work or panic when a field fills itself in.
- **Flag the irreversible.** Finalizing, sending an invoice, sending client email, revoking portal access, deleting — mark these clearly.
- **Locale.** The firm is Philippine. Dates in `en-PH` / Asia/Manila, currency in ₱, VAT at 12%. Use realistic Philippine legal terminology and realistic example matter/party names.
- **Voice.** Direct and concrete. Second person. Short sentences. No marketing tone, no "simply" / "just."
- **Formatting.** Markdown with a table of contents per guide, `###` per feature, numbered steps for procedures, tables for status enums and role-permission matrices, Mermaid for flows. Reference screens by their in-app label and path, e.g. "Billing Review (`/finance/dtr-review`)".
- **Length.** Completeness over brevity in Tier 1 — expect several thousand words per role guide. But no filler; if a screen is trivial, one paragraph is right. Tiers 2 and 3 have hard length limits stated above; respect them over completeness.

## Phase 4 — capture the visual aids

The guides must show the system, not just describe it. Every major workflow gets real annotated screenshots.

### Running the app

- Start the dev server with the Browser pane: `preview_start` with `{name: "next-dev"}` (already configured in `.claude/launch.json`, port 3000). Never run the dev server through Bash.
- Sign in as each role using the dev impersonation endpoint: `/api/dev/team-signin` renders a picker of active team users, and `/api/dev/team-signin?email=<addr>` signs in as that user and redirects to `/dashboard`. It is dev-only and 404s in production. Use it to capture each role's view without handling anyone's password.
- Pick one representative user per role — `lawyer`, `partner`, `finance`, `admin`, `liaison_officer`, `chief_liaison_officer` — and capture that role's surfaces as that user, so what's in the screenshot matches what that role actually sees.

### Anonymization — required before every capture

**The dev server runs against the production database. Real client names, matter titles, party names, email addresses, and invoice amounts are privileged information and must never be committed to this repo.**

Before capturing any screen, inject a client-side anonymization layer via `javascript_tool` that rewrites sensitive text in the DOM. Requirements:

- **Deterministic and stable.** Hash each real value to pick from a fixed pool of fake values, so the same real client renders as the same fake client in every screenshot across every guide. Inconsistent names between two screenshots of the same workflow make the guides unusable.
- **Realistic Philippine substitutes.** Client and party names should look like plausible PH individuals and corporations (e.g. "Rosales Manufacturing Corp.", "Cabrera, Ana Lucia"). Matter titles should read like real matters. Keep amounts in ₱ with plausible magnitudes — don't replace `₱ 847,250.00` with `₱ 1.00`.
- **Cover every channel:** client/party/corporation names, matter and matter-group titles, person names and nicknames, email addresses and subject lines, phone numbers, addresses, docket/case numbers, invoice numbers, and monetary amounts. Sweep text nodes, `title`/`alt`/`placeholder` attributes, and `value` on inputs.
- Do not anonymize team member names where the guide is explaining assignment or team workflows — internal staff names are fine and make the screenshots more legible. Anonymize clients and opposing parties.
- **Verify before saving.** After injecting, re-read the page and confirm no real client string survived. If a screen resists anonymization, skip it and describe it in prose rather than shipping a leak.

Write this layer as a committed script at `docs/guides/capture/anonymize.js` so future recaptures reuse it rather than reinventing it.

### Capture standards

- Viewport 1440×900, light mode, via `resize_window`. Use `resize_window` with `mobile` only where the guide documents mobile-specific behavior.
- Capture the smallest region that makes the point — crop to the relevant panel rather than shooting the whole browser chrome. Use `computer` `zoom` on a region where a full-page shot would render the detail unreadable.
- **Annotate.** A bare screenshot is much less useful than one with numbered callouts keyed to the numbered steps in the surrounding text. Where a procedure has steps, mark the corresponding UI elements `1`, `2`, `3` and reference them in the prose.
- Populated states only. A screenshot of an empty list teaches nothing — navigate to a matter or invoice that actually has content.
- Save as PNG to `docs/guides/images/<role>/<screen-slug>.png` (e.g. `docs/guides/images/finance/dtr-review-bundle.png`). Kebab-case, descriptive of the screen and state, not sequential numbers.
- Every image needs alt text describing what it shows, for anyone reading the Markdown as plain text.

### What gets images, per tier

- **Guides:** liberally. Every significant screen and every step of the core workflows. Aim for at least one image per `###` feature section.
- **Cheatsheets:** none. The one-page limit is absolute and images are the first thing that breaks it.
- **Decks:** one hero image per workflow section — the single screen that anchors the point being made. Decks lean on Mermaid diagrams for process and screenshots for orientation.

### Keeping them from going stale

Write `docs/guides/capture/manifest.md` listing, for each image: the file path, the route captured, the role signed in as, and any setup needed to reach that state. Anyone can then regenerate the full set after a UI change instead of guessing what a screenshot was supposed to show.

## Phase 5 — derive and reconcile

After Tier 2 and Tier 3 are written, do a consistency pass across all three tiers per role:

- Every path, screen label, status name, and role restriction must match the guide exactly. Same wording, not paraphrased.
- Every irreversible action flagged in the guide is flagged in the cheatsheet and has a deck slide.
- Every automatic/background behavior in the guide appears in the cheatsheet's "happens on its own" section.
- No orphan facts — nothing in the cheatsheet or deck that the guide doesn't back up.
- Every image referenced by a guide or deck exists at its stated path, and every captured image is referenced somewhere. No broken links, no orphans.
- Spot-check three screenshots from different roles for surviving real client data before finishing.

Report anything you had to change in the guide as a result of this pass; a gap found while compressing usually means the guide was incomplete.

## Phase 6 — wire up ongoing maintenance

These guides are worthless the moment they drift, and worse than worthless once people still trust them. Before finishing, build the machinery that keeps them current as features ship.

### 1. Make it part of the editing contract

Add a `## User guides` section to `CLAUDE.md` — the file every agent session reads before touching this codebase. It must state:

- Any change that adds, removes, or alters a **user-facing** behavior requires updating `docs/guides/` in the same change. Not a follow-up, not a TODO — same PR.
- What counts as user-facing: a new route or screen, a changed workflow or status transition, a new or renamed field the user fills in, a changed permission or role gate, a new automatic/background behavior, a new irreversible action.
- What does not: refactors, type changes, internal helper moves, test-only changes, performance work with no behavior change.
- The propagation rule — a guide edit cascades to the cheatsheet and deck for that role if the change touches a top-task, a status enum, an irreversible action, or an automatic behavior.
- Screenshots: if the change alters a screen that `docs/guides/capture/manifest.md` lists, recapture it using the manifest's recorded route and role.

Keep it to the same terse, rule-shaped voice as the rest of `CLAUDE.md`. It is an instruction to future agents, not prose for humans.

### 2. Build a repeatable update skill

Create `.claude/skills/update-guides/SKILL.md` — a skill invocable as `/update-guides` that takes a diff (default: uncommitted changes plus commits since the guides were last verified) and:

1. Classifies each change as user-facing or not, per the rules above.
2. For each user-facing change, identifies which roles are affected — by cross-referencing the touched routes against the role gating in `proxy.ts`.
3. Updates the affected comprehensive guide sections first, then propagates to cheatsheet and deck per the rule above.
4. Recaptures any screenshots the manifest maps to the changed screens, reusing `docs/guides/capture/anonymize.js`.
5. Runs the Phase 5 reconciliation pass over just the touched roles.
6. Reports what it changed and what it deliberately left alone.

The skill's frontmatter `description` should make it auto-suggestable when someone has just shipped a user-facing feature.

### 3. Make staleness visible

Footer every guide, cheatsheet, and deck with:

```
_Last verified against commit `<sha>` on <YYYY-MM-DD>._
```

Set it during this run and have `/update-guides` refresh it. A reader can then tell at a glance whether they're looking at something current, and `git log <sha>..HEAD -- app/` shows exactly what has shipped since a guide was last checked.

### 4. Note the escape hatch

In `docs/guides/README.md`, tell maintainers that a full regeneration is always available by re-running the original prompt at `docs/prompts/lumilex-user-guides.md`. Incremental updates are correct for a feature; a rebuild is correct after a large refactor or a redesign.

## Constraints

- Documentation and captured images only. Do not modify application code or run migrations. The only exceptions are the Phase 6 artifacts: a new `## User guides` section in `CLAUDE.md` and a new `.claude/skills/update-guides/SKILL.md`.
- **The dev server points at production data. Read-only throughout.** Navigate and capture, but do not click anything that creates, edits, sends, finalizes, or deletes — no test invoices, no draft emails, no status changes. If documenting an action requires seeing its result, find an existing record already in that state rather than putting one there.
- Read-only DB access is fine (`list_tables`, `execute_sql` for schema inspection). Do not write.
- No real client, party, or matter identifiers in any committed file — Markdown or image.
- Do not commit or push unless asked.

## Finish with

A short summary of what you wrote across all three tiers, plus a list of anything you found that is genuinely unclear, appears half-built, or where the code contradicts existing docs — kept out of the guides and reported separately.
