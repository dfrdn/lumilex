# Multitenancy follow-ups

Open items left behind by the multi-tenant conversion (phases 0–9, 2026-08-23).
Everything here was found during that work, verified enough to be worth
recording, and deliberately **not** fixed in-phase — either because it needed a
decision, or because it wanted one systematic change rather than several
piecemeal ones.

Ordered by consequence, not effort.

---

## 1. ~~Six endpoints trust a caller-supplied storage path~~ — DONE

**Security.** Phase 9 fixed three of these (`admin/finalize` copy + download,
portal upload commit) and found six more of the same shape: the request named a
storage path and the handler recorded or signed it under service-role, with no
check that the path belonged to the caller's firm.

Closed by applying one rule uniformly to all six. The rule lives in
[lib/storage/upload-path.ts](../lib/storage/upload-path.ts) — `checkPathUnder` /
`assertPathUnder` / `pathsNotUnder`, matching at a path-segment boundary and
rejecting `..`/`.` segments, empty segments, backslashes and absolute keys, with
colocated tests. Six inline `startsWith` calls is how one of them drifts.

Each handler now: (1) reads the parent entity through the firm-scoped client so
a cross-firm id comes back empty → 404; (2) derives the prefix server-side from
that entity via `firmStoragePath(firmId, …)` in *both* phases; (3) refuses a
supplied path outside it with a 400, before any existence check, so the refusal
says nothing about what is in the bucket. All six now mint under the firm
prefix, which also makes them reachable through `/api/file-sign` and
`/api/files/download` for the first time — both require the prefix, so
deliverable-file downloads were silently 404ing before.

`scripts/storage-probe.ts` grew a third part: it signs firm B in against the dev
server and performs the real attack against every two-phase commit, each paired
with a control that must succeed. `--require-live` turns a missing dev server
into a failure instead of a skip. `KNOWN_SHARED_PATHS` shrank by seven entries;
the rest of that backlog (status-report, exhibits, red-team, engagement
proposals, signatures, email attachments, chat) is unchanged.

## 2. ~~Telegram bots are not per-firm routable~~ — MOOT (2026-08-29), feature deleted

The integration was cut rather than finished: it required every staff member to
adopt Telegram, and the routing gap below meant only a `usePlatformEnv` firm
could exchange messages at all. Deleting it also closed the unfinished piece of
it that was a live design risk — a public, unauthenticated webhook
authenticating one global `TELEGRAM_WEBHOOK_SECRET` before any firm was known.

The assistant it fronted survives on the web surface; the generic half of
`lib/telegram/` moved into `lib/assistant/` (see CLAUDE.md → "Telegram and
clock-in are gone"). `telegram_link_codes`, `telegram_messages` and
`team.telegram_user_id` remain in the database, inert.

## 3. ~~Role-shell navigation ignores feature flags~~ — DONE

A server-rendered `FeatureProvider` (mirroring `BrandProvider`) is mounted in all
four role layouts, with the client-safe half split into `lib/firm/feature-shape.ts`
so `node:crypto`/web-push stay out of the browser bundle. `NavItem` gained
`features?: FeatureKey[]`, gated at two chokepoints so a section that empties out
disappears rather than leaving a labelled empty box. Verified in the browser by
toggling flags. Original problem below.


Server-side route gating is done — a disabled feature's pages redirect. But
`DashboardShell`, `AdminShell`, `FinanceShell`, `LiaisonShell` are `'use client'`
with module-level nav arrays constructed per page (67 pages for Dashboard
alone), so a firm without Issuances / Drafting Studio / Red Team / Integrations /
the portal still sees those links; clicking one lands on a redirect.
`components/detail/DeliverableActionRow.tsx` deep-links Red Team the same way.

Fix with a server-rendered feature-flags context in each role layout, mirroring
`BrandProvider`. Note `lib/firm/features.ts` reaches `node:crypto` and web-push,
so a client component must not import it — follow the client-safe split at
`lib/firm/brand-shape.ts`.

## 4. ~~Three RPCs are still firm-blind~~ — DONE

Fixed in `20260824_firm_scope_blind_rpcs.sql`, following the phase-5 shape of
`20260823_firm_scope_conflict_rpcs.sql`: `p_firm_id uuid` first, required, no
default, so a stale call site fails to resolve (PGRST202) instead of silently
searching every firm; every underlying table filtered on it; `search_path`
pinned; old signatures dropped.

- `chat_unread_counts(text[])` → `(uuid, text[])` — `lib/chat/push-dispatcher.ts`
- `client_last_activity()` → `(uuid)` — `lib/queries/client-management.ts`
- `matter_group_members(text)` → `(uuid, text)` — `lib/queries/matter-groups.ts`

Two notes for anyone reading the definitions. `client_last_activity`'s `filings`
branch is inlined against `deliverables` — `filings` is a view and exposes no
`firm_id`, so there was nothing to filter it on. And `matter_group_members` ends
on a join back to `matters`: `related_matter_ids` is a bare text array with no FK
behind it, so the walk can step onto an id this firm does not own.

## 5. ~~Seven upsert conflict targets are still globally unique~~ — DONE

Fixed in `20260824_firm_upsert_conflict_targets_wave5.sql`. Introspection found
eleven, not seven — and three were worse than blocked: their call sites were
*already* on the scoped client, so the rewritten `firm_id,<cols>` target
resolved against nothing and the write failed outright with 42P10. Those three —
`email_matter_links` (`lib/email-linking.ts` auto-linking), `matter_exec_summaries`
and `matter_group_summaries` (both AI-summary saves) — were live-broken, and are
the reason to introspect rather than trust a list.

Composite `(firm_id, …)` uniques added for: `email_matter_links`,
`matter_exec_summaries`, `matter_group_summaries`, `matter_billing_configs`,
`notification_mutes`, `partner_matter_annotations`, `push_subscriptions`,
`evaluations`, `evaluation_scores`, `evaluation_period_other_bonuses`,
`evaluation_period_discretionary_bonuses`. Global uniques kept alongside, as in
wave 3, except the two below. Every authed-client upsert on those targets was
then pointed at the firm-local target, so an upsert from one firm can no longer
resolve onto another firm's row and get refused by RLS instead of inserting.

**`user_preferences` is rekeyed**: `PRIMARY KEY (email)` → `(firm_id, email)`.
One address could hold exactly one preferences row on the whole instance, so a
person who works at two tenants could have notification settings at only one, and
whichever firm wrote second took the first one's row over. RLS already read it as
`firm_id = current_firm_id() AND email = current_email()`; the key has caught up.
`scripts/rls-probe.ts` asserts the two-firms-one-address case directly.

**`emails.internet_message_id`**: the global partial unique is *dropped* and
replaced by `(firm_id, internet_message_id)`. Keeping it would preserve exactly
the collision the composite exists to remove — two tenants copied on one message,
second sync 23505s and drops a client email. The only readers are
`lib/email-sync.ts`'s two dedup lookups, both firm-scoped, so `.single()` stays
single-rowed.

Still globally unique, deliberately: **`resolution_templates.id`** is a global
text PK (see §10), so a `(firm_id, id)` index would change nothing while the PK
stands — seeded ids stay namespaced `<slug>:<key>`. And
**`push_subscriptions.endpoint`** keeps its global unique: a browser endpoint is
per-origin and each firm has its own host, so the cross-firm case is theoretical;
the composite is there if it stops being.

## 6. ~~Starter content still carries the origin firm's figures~~ — DONE

**Owner's decision: no starter rates at all.** A firm quoting no rates is
recoverable; a firm quoting another firm's rates is not. So `lib/fee-schedule/default.ts`
is deleted rather than renumbered, and `loadFeeSchedules(firmId)` throws
`FeeSchedulesNotConfigured` when the firm has none — naming the fix in the
message. Everything that quotes or binds a schedule inherits that: the
engagement-proposal catalogue and drafter, the proposal package's Annex "A", the
PDF export.

The split that makes fail-loud liveable is the one `lib/billing/firm-defaults.ts`
already uses for invoice settings: `loadFeeSchedules` throws for anything that
would *print* a figure, `findFeeSchedules` is the non-throwing reader for the
settings surface. The CMS opens on the seed pack's unpriced skeletons flagged
`isTemplate` — structure to fill in, never a number the firm did not set — and
`pricedTiers()` returns nothing until it saves.

The dev firm is seeded from the seed pack (`scripts/seed-fee-schedules.ts <firmId>`,
same shape as `seed-resolution-templates`); `scripts/provision-firm.ts` already
did this for a new firm.

`lib/firm-profile/default.ts` was checked and needed nothing: phase 6 blanked it
to a skeleton and `loadFirmProfile` already throws. It survives only as the blank
document the profile CMS opens on — the same role the seed-pack skeleton now
plays for fee schedules.

Still an in-code fallback, and out of scope here because it carries no money:
`lib/scope-library/default.ts`, which `loadScopeTemplates` layers per slug. Its
wording was transcribed from one firm's sent proposals — flagged, not decided, in
`lib/provisioning/seed-pack/scope-templates.ts`.

## 7. ~~Transactional email links point at the platform, not the firm~~ — DONE

Fixed in `2e78a51e`. `firmBaseUrl(firmId)` in `lib/firm/config.ts` resolves the
firm's primary host from `firm_domains`, swapping only the hostname of the
platform URL so its scheme and port carry over (dev http/:3000, production
https/no-port, one code path). Wired into `loadEmailIdentity` — the single
chokepoint for every branded email — plus the push icon and the portal
file-request link. A firm with no domain falls back to the platform URL.

## 8. ~~Fonts~~ — DONE

EB Garamond + Cormorant, OFL, embedded as static instances cut from the upstream
variable fonts with fontTools — both families now ship variable-only, and pdfkit
dedupes embedded fonts on their name records, so a bold alias off the same file
renders regular with no error. `standard` is now the Garamond pairing; the old
14-standard-PDF-fonts set is preserved as `core`. Original notes below.


The licensed faces (Felix Titling, Adobe Garamond Pro) were moved out of the repo
to a private folder outside the repo — they cannot ship to tenants. The PDF
renderer now uses a curated registry built on the 14 standard PDF fonts:
legally clean, embeds nothing, renders everywhere, but plain for legal documents.

`Forum-Regular.ttf` is actually OFL-licensed (Google Fonts) and could legitimately
be re-bundled; EB Garamond or Cormorant would be closer to the original look.
`lib/pdf/fonts.ts` throws rather than substituting when a set is incomplete, and
`public/fonts/README.md` documents the contract for adding one (files plus a
redistributable LICENSE beside them).

## 9. ~~`docs/guides/` still names the origin firm~~ — DONE (except the PDFs)

Guides, cheatsheets and decks de-branded; `capture/anonymize.js` had its staff
allowlist and firm domains made runtime-seeded rather than hardcoded. The brand
gate now covers `docs/guides` via `grep -riIl`. **Three stale PDFs remain** —
see item 12. Original notes below.


Outside the phase-6 grep gate's scope (`app lib components public`), so not a
regression, but plainly against intent: the guides carry `<origin prefix>-YYYY-MM-###`
invoice examples, the origin firm's finance mailbox, real staff names, and an overview deck
titled with the firm's name. Several `seed-guide-*` / `seed-playbook-*` /
`seed-protocols` scripts also still write `resources` without `firm_id` and are
broken since the phase-5 default drop.

## 10. ~~Inserts that omit `firm_id` and now 23502 / 42501~~ — DONE, and gated

**Live breakage, not tenancy holes** — the phase-5 drop of the transitional
`firm_id` column defaults turned every path that had been quietly relying on
them into a hard failure. They are all *create* flows, so each one presented as
"the + Add button 500s".

Found and fixed one at a time four times over (`reconcileExpectedPairs`,
`notify_new_deliverable`, `/api/admin/[entity]` POST, `createDeadlineChain`),
which is what finally made the case for a ratchet instead of a fifth sweep:
**`npm run verify:firm-id`** ([scripts/audit-firm-id-stamping.ts](../scripts/audit-firm-id-stamping.ts))
resolves every `.from(t).insert|upsert()` under `app/` and `lib/` to the client
that actually reaches it and fails CI on an unstamped write. It reports 208
writes, 0 allowlisted, 0 unresolved. See CLAUDE.md → RLS migration playbook for
the rule; the allowlist is empty and should stay that way.

Closed out in that sweep:

- ~~**`notify_new_deliverable()`** inserted into `notifications` without
  `firm_id`, so any deliverable insert carrying drafters raised 23502 and the
  whole insert rolled back.~~ **Fixed** by
  `20260824_notify_new_deliverable_firm_id.sql`. It really was the only trigger
  with this shape: a re-sweep of every `public` function that inserts into a
  `firm_id` table finds none remaining.
- ~~**`app/api/admin/[entity]` POST**~~ and ~~**`/api/admin/batch-import`**~~
  built their row and inserted it through the authed client without stamping
  `firm_id`, so every admin table's "+ Add" and every CSV import 500'd.
  **Fixed** — both now stamp, *conditionally on the tenant registry*: they write
  a computed `config.dbTable`, and one admin entity (`ph_holidays`) is a global
  table with no `firm_id` column, so an unconditional stamp just trades 23502
  for 42703.
- ~~**`createDeadlineChain()`**~~ (`lib/legal/deadline-chains.ts`) inserted
  `deadline_chains`, `deliverables`, `hearings` and `deadline_chain_items` with
  no `firm_id` on the authed client — the whole "compute a deadline chain" flow.
  **Fixed**; it already took `firmId`.
- ~~**`applyInvoicePayment()`**, **`applyDepositToInvoice()`**,
  **`spawnComplianceDeliverables()`**, **`persistInvoice()`**~~ — the shape the
  ratchet was needed for. Each reads its client from a *parameter*, so it was
  correct on the cron/service callers and broken on one authed handler apiece
  (`/api/finance/clients/payments`, `/api/finance/clients/deposits/apply`,
  `/api/corporation`, `/api/finance/dtr-review/generate` + `/api/finance/batch-generate`).
  No per-file scan can see that. **Fixed**: each takes `firmId` and stamps
  unconditionally, so it is correct under either client.
- ~~**`reconcileExpectedPairs()`** (`lib/evaluations/assignments.ts`) upserted
  `evaluations` rows with no `firm_id`.~~ **Fixed** alongside §5. All three
  callers swallow the failure ("proceed to show whatever rows already exist"),
  which is what kept it invisible. That shape is still worth a sweep of its own:
  a `try/catch` that treats a write failure as non-fatal hides a 23502
  perfectly.

~~Unrelated breakage found while browser-testing the above, still open: **the PH
Holidays "+ Add" 500s**~~ — **DONE** (`f4f53237`). `ph_holidays` had no
`primaryKeyColumn` in `lib/admin/entity-config.ts`, so the shared admin handler
minted a `notion_id` and stamped `created_time`, neither of which that table has,
and every write failed 42703 — "+ Add", inline edit, delete and the CSV import
alike. Fixed by declaring `primaryKeyColumn: 'id'`; both the single-row POST and
`/api/admin/batch-import` already branch on `usesNotionIdPk`, so the one
declaration closes all four. Predated this work and was never a `firm_id`
problem.

Verified under a real admin JWT through RLS, both inserts rolled back: today's
row shape (no `notion_id`, no `created_time`) is **accepted**, and the pre-fix
shape is refused `42703 column "notion_id" of relation "ph_holidays" does not
exist` — the negative control that shows the declaration is what carries it.

## 10a. Person-shaped constants that `verify:brand` cannot see (found 2026-08-29)

The evaluations cut turned up a de-branding hole worth stating on its own.
`verify:brand` greps for the origin firm's **name**. It
therefore cannot see a real person encoded as **initials**, and that is how
compensation data was actually written:

- ~~`lib/evaluations/partner-shares.ts`~~ — one firm's partner profit shares as
  `{ ADC: 0.40, BEL: 0.30, CMR: 0.15, DNP: 0.10, EOS: 0.05 }`. **Gone** with
  the evaluations cut, but it sat in `lib/` through every de-branding pass and
  every green `verify:brand` run.
- ~~`team.bonus_profile`~~ — surfaced as `bonusProfile: 'standard' | 'qzx'`,
  where `'qzx'` (one person's initials) selected a different indicative bonus
  band (0.25–0.5 months against 0.5–2.0) and rendered a literal "QZX" badge on
  the lawyer detail page: one named individual's compensation arrangement,
  encoded as a product enum, on a surface a tenant's partners would see.
  **Gone** — `20260829_drop_bonus_profile.sql`, card and all.

Both are now gone, but neither was found by a gate — both were found by reading
code during an unrelated cut, which is the part worth fixing.

**DONE (2026-08-29): `npm run verify:person-shaped`.**
[scripts/audit-person-shaped.ts](../scripts/audit-person-shaped.ts) over a pure
rule in [lib/debrand/person-shaped.ts](../lib/debrand/person-shaped.ts), in the
`verify` chain next to `verify:brand`. It flags every short opaque token in the
two positions the real constants occupied — an object key mapping to a number,
and a string-union member — across `app lib components scripts`, and each must
be named in a grouped allowlist (`vocabulary`, `ph_legal`, `formats`,
`technical`). 1200 files, 137 tokens seeded, 0 unnamed.

It is an allowlist ratchet, not a classifier: `qzx` and `bsp` are the same
shape and only a human knows which is the central bank, so the gate's job is to
force the question rather than answer it.

**The prototype rule proposed above was wrong in two ways, and the negative
controls caught both:**

- `^[A-Z]{2,4}$` misses `'qzx'` — initials are not always uppercase. The rule
  is case-insensitive.
- The first union pattern matched a token only when *followed* by `|`, so it
  missed `'qzx'` again: it was the **last** member of its union. Both sides of
  the pipe are matched now.

That is the argument for writing the negative control from the real constant
rather than from a plausible-looking fixture. Both are reconstructed, in their
original shape with stand-in initials and figures, in `lib/debrand/person-shaped.test.ts`, and a live control (planting both in a
real file, confirming exit 1, then removing it) was run against the script.

**What it still does not cover**, deliberately: a full name in a string, a
nickname longer than four characters, initials in a comment or in JSX text, and
anything outside those four directories. One shape, caught well.

## 11. Smaller items

- `resolution_templates` uses a global text primary key; phase 8 namespaced seeded
  ids as `<slug>:<key>` to work around it. §5 deliberately did not add a
  `(firm_id, id)` unique — it would change nothing while the PK is global.
- ~~`lib/pdf/proposal-package.ts` calls `loadFeeSchedules(firmId)`
  unconditionally, before checking whether the proposal asked for any fee
  annexes.~~ — DONE (2026-08-25). The loader throws for a firm with no schedules
  (§6), so a profile-only annex package for an unseeded firm failed on a rate
  card it never quotes; the load is now `wanted.length > 0 ? await
  loadFeeSchedules(firmId) : []`. The throw is intact for a package that does
  ask for a fee annex — `/api/proposals/[id]/export` surfaces its remediation
  message — which is the point of §6.
- `lib/docx/template.docx` is read from disk at runtime but never pinned in
  `next.config.ts` `outputFileTracingIncludes` (pre-existing).
- Dead code: the Claude-Skills `generateBillingLetterDocx`,
  `markBriefStaleForFile` / `markBriefStaleForDeliverableFile` (zero callers),
  possibly `fetchGroupPostAttachments`.
- `matter_briefs` is referenced in CLAUDE.md but does not exist in the database.
- Legacy unprefixed storage objects remain in the dev project (88 in `files`, 12
  in `templates`, 2 `documents`, 1 `receipts`). Harmless — no code path resolves
  to them any more — but they'd need moving in a real data migration.

## 12. Surfaced 2026-08-24 while closing items 1–11

Found by agents doing the work above, each deliberately left rather than widening
a diff. Roughly ordered by consequence.

- ~~**Ten seed scripts are broken.**~~ **DONE (2026-08-25).** Introspection
  confirmed the set is exactly ten — every `scripts/` file that writes
  `resources`. All now go through [scripts/resource-seed.ts](../scripts/resource-seed.ts),
  which holds the firm argument, the id-or-slug resolution, `getServiceDbForFirm`
  and the insert-only-what-is-missing rule once rather than ten times. Each
  script is now its content plus a `runSeed(...)` call. `--force` overwrites,
  which is what the two update-only scripts used to do unconditionally.
  - Two of the ten (`seed-protocols`, `seed-style-guide`) were *not* 23502 —
    they only ever `UPDATE ... .eq('slug', '<origin>-protocols'|'<origin>-style-guide')`
    and the dev database has no `resources` rows at all, so they failed on the
    missing row. Both now insert, under de-branded slugs (`protocols`,
    `style-guide`). Nothing pointed at the old slugs.
  - Three (`seed-playbook-*`) upserted `onConflict: 'slug'`, but §5 replaced that
    with `resources_firm_slug_key (firm_id, slug)` — a bare `slug` conflict
    target now raises 42P10. They no longer upsert.
  - `author_name` was the origin firm's name in seven of them, not just the
    workshop; it is now the seeding firm's own name.
  - `seed-legal-writing-workshop` was **deleted** (2026-08-25). Its deck was
    firm-proprietary and left the repo in phase 0, and resources are a firm's
    own to fill — see the decision below.
  - **The mismatch is a small class, and it extended one file further.**
    `/api/admin/batch-import` synthesized `notion_id` *unconditionally*, never
    consulting `primaryKeyColumn` — so CSV import was broken for all four
    serial-keyed entities (`ph_holidays`, `liaison_tasks`, `trademarks`,
    `transportation_zones`), not just the one. It now mirrors the single-row
    POST's `usesNotionIdPk` check.
  - Introspecting all eleven `dbTable`s against every `supabaseColumn` in
    `ENTITY_CONFIGS` found **no other** column that the table lacks. The four
    that look like exceptions — `related_parent_name`, `related_sr_name`,
    `has_filed_copy`, `zone_name` — are deliberate synthetics, already listed in
    the route's `SYNTHETIC_COLUMNS` and enriched on read.
- ~~**`persistInvoice`'s firm_id fix is not exercised end to end.**~~ **DONE
  (2026-08-25).** `scripts/rls-probe.ts` now provisions a whole billable bundle
  per probe firm — complete `firm_invoice_settings`, a rate card, a matter
  billing config, unbilled DTR and an unbilled matter expense, and an
  approved+cleared `dtr_revision_reviews` row — and drives the pipeline both
  handlers drive (`checkBundleCleared`, then `generateBundleInvoice` with their
  exact arguments) on a client signed in as a real **finance** user. It asserts
  the `invoices` row's `firm_id`, that every DTR entry behind the jsonb line
  items belongs to that firm, exact totals, the resolved `client_id`, the frozen
  settings snapshot's letterhead and bank, the storage prefix, and that both
  firms independently mint `…-001` under their own prefixes. Regenerate is
  covered too (same row, same number, `firm_id` untouched).
  - It is a probe check, not a vitest test, because nothing in it can be mocked
    without mocking away the fix: the number comes from a SECURITY DEFINER RPC
    that authorises on the caller's own JWT, the letter and breakdown render
    from the firm's `firms.branding`, three objects are uploaded under the
    firm's storage prefix, and the row is written through RLS.
  - Negative control: deleting the `firm_id: firmId` stamp turns it red with
    `42501 new row violates row-level security policy for table "invoices"` —
    which is exactly the live break the fix prevents, since `invoices_finance_all`'s
    `with_check` evaluates the NULL before the NOT NULL does.
  - The path itself turned out to be sound: nothing else about these two callers
    was broken. See the `fetchBillingData` note below for the one inaccuracy found.
- ~~**`fetchBillingData` does not filter DTR on `billed`**~~ — **DONE
  (2026-08-29), by correcting the comment.** Introspection confirmed the split is
  five-to-one, not two-to-one: reimbursements and `matter_expenses` filter on
  `billed` in the fetch, and action entries, milestones and acceptance fees on
  `invoiced` / `acceptance_fee_paid` in `deriveFeeLines`. Only DTR is unfiltered —
  `getDTRBundleEntries` reads every entry in the bundle whatever its `billed`
  state.

  **The code was left alone deliberately.** Adding `.eq('billed', false)` to the
  DTR path would be a no-op on the regenerate path (the flags are cleared two
  lines above it) and, anywhere else, would *silently drop billable hours* — the
  exact failure the same comment records having already caused for per-action
  invoices and for expenses on drafts that had been sent. A visible duplicate
  finance can see beats hours that vanish. So the comment now names which five
  types the fresh fetch skips, and says what actually protects DTRs: a DTR
  belongs to exactly one (client, month) bundle and only bundle invoices bill
  DTRs, so the invoice being regenerated is the only one that could have flagged
  it.

  **Left open, and newly recorded there:** that protection rests on one invoice
  per client+month, which **nothing in the schema enforces** — `invoices` is
  unique on `(firm_id, invoice_number)` and on `id`, and nothing else. The dedup
  is the application-level lookup in `generateBundleInvoice`, which
  `.order('id', desc).limit(1)`s — i.e. it already assumes it may find more than
  one. Two concurrent generations for the same client+month both find nothing and
  both insert; the DTRs billed on the first would then be re-billed on the
  second. A `(firm_id, client_name, billing_month)` unique is the fix, but it is
  a decision with a data check behind it (existing duplicates would block the
  index), not a drive-by.
- ~~**`verify:live` no longer proves per-firm error isolation.**~~ — **DONE
  (2026-08-31).** Re-pointed at `files.file_urls` and back to 12/12 in
  `scripts/cron-probe.ts`.

  The catalog sweep that made this look hard was right about text columns and
  wrong about the conclusion. `attendance.date_label` really was the last TEXT
  date column the remaining crons read — but the vehicle never needed to be a
  text column, only a value that reaches a `JSON.parse`. `files.file_urls` is
  **jsonb**, so Postgres refuses malformed JSON; it does *not* refuse a jsonb
  **scalar string**, which supabase-js returns as a JS string, which is exactly
  what `/api/file-analysis/backfill`'s `typeof file_urls === 'string'` legacy
  branch feeds to `JSON.parse`. That branch exists for old rows; this is the
  shape it mishandles, so the fixture is a real failure mode rather than a
  contrived one.

  Verified before being written in (jsonb accepts it, it round-trips as a JS
  string, `JSON.parse` throws, and the handler's own `.neq('file_urls','[]')`
  still selects it), and the check carries a fourth assertion that the reported
  error **is** the planted parse failure — a firm broken for some other reason
  would otherwise satisfy it and prove nothing. Negative control run: with the
  poison not planted, the two dependent checks go red and the probe firm comes
  back `ok: true, processed: 0`.

  **One property to watch.** The request uses `offset: 0`, so every firm reads
  its own first batch of files. That is free today because the dev firm has no
  `files` rows at all; if this project ever holds a real file corpus, the check
  would start doing that firm's genuine backfill work — including AI analysis —
  on every run. Noted in the probe at the call site.

- **Two `verify:rls` runs at once destroy each other.** The probe keys its
  fixtures on fixed slugs (`probe-a`/`probe-b`) and fixed emails, which is
  exactly what lets its opening teardown clean up after a crashed run — and what
  makes a second concurrent run delete the first's firms, auth users and rows
  mid-flight. The first then reports 42501s and empty reads that read as RLS
  regressions and are not. Pre-existing (`verify:storage` and `verify:platform`
  have the same shape with their own slugs), but it bites more often now that the
  run is ~10s longer. Two mitigations are in, neither a fix: teardown sweeps
  storage under the firm ids *this run minted* as well as the ones the slugs
  resolve to (otherwise a colliding run leaves the invoice objects orphaned with
  nothing naming them — observed once), and a closing check —
  "the fixtures this run provisioned are still its own", canaried on the firm
  ids plus their `firm_invoice_settings` rows — names the collision instead of
  letting it masquerade. **Run the probes serially.** A real fix is a
  per-run fixture namespace plus an age-based sweep for crashed runs, or a
  Postgres advisory lock around the whole probe.
- **Three stale PDFs still name the origin firm**: `docs/guides/pdf/{guide,deck,
  cheatsheet}-finance.pdf`. The markdown was scrubbed; regenerating needs a
  transient `marked` install, a static server, headless Chromium and the mermaid
  CDN, and a botched render is worse than a stale one. `index.pdf` also quotes a
  sentence long since deleted from `README.md`.
- ~~**Three surfaces have nav gates but no server gate**~~ **DONE (2026-08-25).**
  The entry's premise was slightly off: all three had *neither* gate. Both were
  added, pages first, and verified in both directions by toggling
  `firm_integrations.enabled` for the dev firm.
  - `/admin/email` → `graph_mail`, redirect `/admin`.
  - `/admin/email-proposals` → `email_autopilot`, redirect `/admin` (matching its
    siblings; its role check still bounces to `/dashboard`). The queue's only
    producer is the autopilot cron, which fans out over
    `forEachFirmWithFeature('email_autopilot')`, so without it the page can only
    ever be empty.
  - `/finance/templates` → `['graph_mail', 'docx_pdf']`, OR semantics, redirect
    `/finance`. It is one page over two halves: the email templates are what
    `BatchSendModal` composes from via `useEmailTemplates`, and both finance send
    routes refuse without `graph_mail`; the billing-letter DOCX template is read
    only by `generateBillingLetterFromTemplate`, whose sole caller is inside
    `persistInvoice`'s `docx_pdf` branch — without that feature the local
    renderer runs and the uploaded template is never opened. So it has something
    to manage while either is on. Gating it on `docx_pdf` alone would have been
    wrong twice over: that key is specifically DOCX→PDF conversion through a real
    OneDrive account, and it would have hidden the email half too.
- ~~**Extend the RLS probe's "insert omitting firm_id is rejected" from one table
  to all 130.**~~ **DONE (2026-08-25)**, as
  `firm_id_insert_refusal_probe()` (`20260825_firm_id_insert_refusal_probe.sql`),
  called from `scripts/rls-probe.ts`. 133 tables (the 132 tenant tables plus
  `firm_domains`, which carries `firm_id` too), ~250ms, one round trip.
  - **Enumeration is the catalog's**, using the same predicate as
    `tenant_tables()`, so a table added tomorrow is covered tomorrow. Two extra
    checks tie that claim down: the sweep's table set must equal
    `tenant_tables()`'s, and `lib/tenancy/tables.generated.ts` must match the
    catalog (a migration that adds a tenant table without regenerating the
    registry now turns `verify:rls` red).
  - **Distinguishing the right refusal from the wrong one** is the whole design.
    Most of these tables have other NOT NULL columns, so a naive insert is
    refused for whichever of them sorts first — which proves nothing. The
    function reads the catalog, synthesises a value for every *other* NOT NULL
    column without a default, and omits only `firm_id`. Postgres checks NOT NULL
    before CHECK constraints, RLS `with_check` and FK triggers, so with the rest
    of the row present the single passing verdict is 23502 whose
    `GET STACKED DIAGNOSTICS COLUMN_NAME` is `firm_id`. Everything else gets its
    own verdict and fails: `accepted` (a default or trigger supplied it — the
    regression this exists for, reported with the offending default expression),
    `refused_other_column` (the synthesised row was incomplete, so that table
    was never actually tested), `refused_other` (23503/23514/22P02 — `firm_id`
    was already non-NULL by the time constraints ran, or the literal map is
    wrong), `unsupported_column_type`, `firm_id_nullable`.
  - **Nothing is committed and nothing drifts.** Each attempt is its own plpgsql
    subtransaction; an insert that *succeeds* is undone immediately by raising a
    private SQLSTATE, so the failing case leaves no more behind than the passing
    one. Identity and serial columns are pinned rather than defaulted, because
    `nextval()` is non-transactional and would otherwise burn ~74 sequence values
    per run and survive the rollback. Measured: 0 rows, 0 sequence drift.
  - **Proven to bite:** re-adding `alter table backfill_state alter column
    firm_id set default '<dev firm>'` turns it red with
    `backfill_state: accepted — insert omitting firm_id SUCCEEDED — column
    default: '…'::uuid` and exits 1. Removing the default restores green.
  - The authed-client check on `tasks` is kept alongside it, renamed
    "(authed client, tasks)": the sweep runs as service_role, and that one is
    what proves the refusal reaches a real caller through PostgREST and RLS.
- **`lib/scope-library/default.ts`** is still an in-code per-slug fallback — the
  same shape as the fee-schedule fallback deleted in §6, and its wording was
  transcribed from one firm's proposals. It carries no money, which is why it was
  not swept with §6.
- **`BreakdownFeeLine.quantity`** reaches the renderer but is never printed, so a
  per-action row aggregating (say) 14 notarisations shows a lump sum with no count
  behind it.
- Typography leftovers: both bundled families default to **oldstyle figures**, so
  display numerals like a cover year set as text figures (`lnum` is available if
  lining figures are wanted); and `app/api/firm-calendar/export-pdf` hardcodes
  Helvetica — unbranded by design, as far as anyone could tell — yet is pinned for
  fonts it never reads.

---

## Next: the platform operator surface (`/platform`)

Decided 2026-08-24. There is currently **no UI that manages firms at all** — no app
route touches the `firms` table. `/admin` is the *firm's own* admin and is
tenant-scoped by design. Creating and configuring a tenant happens through
`scripts/provision-firm.ts` and hand-written SQL.

**This surface deliberately sits outside the tenancy model**, and everything the
conversion built will (correctly) resist it:

- `super_user` is a *firm-level* role in `team.role`, so no existing identity can
  see across firms.
- The authed client is blocked by `firms_self_select` (own firm only), and
  `getServiceDbForFirm` is single-firm by construction. The surface needs raw
  service-role plus its own authorization — which `eslint.config.mjs` and
  `scripts/audit-service-role.ts` forbid by default. It needs an explicit, narrow
  allowlist entry, and that friction is the point: the one cross-tenant surface
  should have to say so out loud.

**Decisions:**
- **Identity: a `platform_operators` table** keyed on `auth_user_id`, separate
  from `team` and `client_users` — a third identity kind, mirroring how those two
  already split staff from portal clients. Deny-by-default RLS, service-role only,
  one guard function the whole surface goes through. Rejected: a flag on `team`
  (a firm-scoped row granting cross-firm power is the coupling this conversion
  removed — one bad UPDATE on a tenant table becomes platform-wide escalation)
  and an env allowlist (no audit trail, redeploy to change).
- **Placement: `/platform` route group in the same app, full management.** List
  firms with status; create a firm (the provisioning script's logic behind a
  form); edit branding, email and document settings; manage `firm_domains`;
  toggle features and store BYO credentials via `lib/firm/secrets.ts`. Replaces
  the CLI + SQL workflow.

**Build notes for whoever picks this up:** `proxy.ts` needs a `/platform` branch
that checks operator identity *before* the team/portal lookups; the operator
session is a third kind alongside `getSession` and `getPortalSession`; the
provisioning script's validation (slug/prefix against the DB's own CHECK regexes,
domain-hijack refusal, fill-what-is-absent idempotency) is the behaviour the form
must preserve — call the same code rather than reimplementing it. Every operator
action belongs in `audit_log`, and the firm it concerns is the `firm_id`.

### Phase A — the boundary and a read-only list — DONE (2026-08-24)

Deliberately split in two: the security boundary first, verified, and the
management forms layered on afterwards. See CLAUDE.md → "The platform operator
surface" for the editing contract; what follows is the reasoning that isn't
obvious from the code.

Built: `platform_operators` (`20260824_platform_operators.sql`, global table, no
`firm_id`, deny-by-default RLS, added to the global list in
`scripts/generate-tenant-registry.ts`), `lib/platform/auth.ts`
(`getOperatorSession` / `requireOperator`), the `proxy.ts` branch, `app/platform/`
with its own shell, `/api/platform/firms`, `logOperatorAudit`,
`scripts/bootstrap-platform-operator.ts`, and `npm run verify:platform`.

Decisions worth keeping:

- **Nothing shared was loosened.** `firms_self_select` is untouched,
  `getServiceDbForFirm` gained no multi-firm mode, and the authed client gained
  no cross-firm reach. The enumeration runs on the *global* tables (`firms`,
  `firm_domains`) through the raw client; everything inside a firm — team count,
  integrations, invoice settings — goes back through
  `getServiceDbForFirm(firm.id)`. That makes the list N+1 on purpose: a single
  unscoped sweep of `team` would be one round trip and also the first place in
  the codebase that reads a tenant table with no firm in hand. The allowlist
  entry is its own `platform-operator` group in `eslint.config.mjs` rather than
  folded into `global-tables`, so adding a file to it is a decision someone has
  to write down.
- **The staff-who-is-also-an-operator case is legal and the sessions stay
  separate.** `lib/platform/auth.ts` never reads `team`; `lib/session.ts` never
  reads `platform_operators`. The probe asserts both halves: that person reaches
  `/platform`, and their `team` row (role, firm) is unchanged by it.
- **`/platform` answers on `APP_BASE_URL`'s hostname only.** In dev that is
  `localhost`, which also happens to be the dev firm's primary domain — the rule
  is "the platform's own host", not "a host no firm has claimed", so it works in
  dev and still keeps the surface off a tenant's domain in production, where the
  platform host should not be in `firm_domains` at all. The branch returns before
  the whitelabel host binding, which is what stops a staff-operator being bounced
  onto their firm's domain mid-session.
- **Cross-tenant reads are audited even though they mutate nothing.** A
  firm-scoped read is unremarkable and unaudited everywhere else in this app; an
  operator reading into a tenant is the thing that tenant would want to see. One
  `actor_type = 'operator'` row per firm listed, in that firm's own log, visible
  through the existing `/admin` audit-log surface. The volume trade-off is real
  (a page load writes one row per firm) and acceptable at operator scale; if the
  tenant count grows past that, dedupe per operator/firm/window rather than
  dropping the record.
- **Rejected for the firm-less case:** a sentinel "platform" row in `firms`
  (`forEachActiveFirm` would enumerate it and every cron would fan out to a fake
  tenant) and a nullable `audit_log.firm_id` (an unscoped row in a tenant table).
  The one genuinely firm-less action today — creating an operator — lives in a
  script, not a request.

**Flagged, not guessed:**

- `scripts/generate-tenant-registry.ts` couldn't run on the repo's Node 20: it
  imports `lib/supabase` without `./probe-websocket`, so `createClient` threw
  before reaching the RPC. One import added. Pre-existing; unrelated to this
  work but it blocked regenerating the registry.
- The end-user guides in `docs/guides/` were **not** updated. Their audience is a
  firm's own staff (lawyer / finance / admin / liaison) and `/platform` is not
  reachable by any of them — a staff member who types the path is redirected. If
  operator documentation is wanted it should be its own document, not a section
  in a tenant-facing guide.
- The root layout's `generateMetadata` resolves the favicon from
  `firm_domains` by request host. In dev, `localhost` maps to the dev firm, so
  `/platform` inherits that firm's monogram in the browser tab. Harmless in dev
  and correct in production (the platform host is unmapped), but worth knowing
  before someone reports it as branding bleed.
- `verify:platform` is wired into `npm run verify`, whose handler half skips
  loudly without a dev server — same convention as `verify:storage` part 3.

### Phase B — the management forms — DONE (2026-08-24)

Built: `lib/provisioning/provision.ts` (the provisioning engine, extracted),
`lib/platform/firm-detail.ts` (per-firm read model + tenant writes),
`lib/platform/operator-lockout.ts` (+ test), the roster functions in
`lib/platform/auth.ts` and the write side in `lib/platform/firms.ts`, five
`/api/platform/*` route files, `/platform/firms/new`, `/platform/firms/[id]`,
`/platform/operators`, and `scripts/platform-probe.ts` grown from 19 checks to
66. See CLAUDE.md → "Phase B — the management forms" for the editing contract;
what follows is the reasoning that isn't obvious from the code.

- **The extraction was the point, not a tidy-up.** `scripts/provision-firm.ts`
  already knew what a valid firm is — the DB's own CHECK patterns, the
  domain-hijack refusal, fill-what-is-absent idempotency, the deliberately
  incomplete invoice row, the all-disabled integrations. A form that
  reimplemented any of that would drift, and the first symptom would be a tenant
  created through the UI that the script considers malformed — or a domain
  quietly taken from another firm. So the logic moved to
  `lib/provisioning/provision.ts` and both callers got thin. The script keeps its
  JSON-config interface: that file is the operator's reviewable, replayable
  record of what a firm was provisioned with, and a form is not.
- **No new allowlist entries, deliberately.** The engine takes its
  `SupabaseClient` as a parameter and imports `@/lib/supabase` nowhere, so it
  reads global tables through whatever client it is handed and every tenant
  table through `getServiceDbForFirm(firmId, db)`. The operator surface's raw
  client stays inside the two files that already had it, and the third new
  module (`firm-detail.ts`, all tenant tables) needs none. `verify:service-role`
  and `verify:firm-id` are both clean without touching `eslint.config.mjs`.
  Rejected: a `getPlatformServiceClient()` export that routes could import — it
  would hand out the raw client while slipping past the audit script, which
  greps for the import, not the capability.
- **Each editor surfaces an existing rule rather than restating it.** Branding /
  email / documents parse through `lib/firm/config.ts`'s own Zod schemas (now
  exported); the invoice form shows exactly `missingInvoiceSettings()`; the
  feature rows show `resolveFeature()`'s `reason` rather than the toggle;
  `featureRequirements(key)` was added to `lib/firm/features.ts` so the form
  renders one input per field the guard actually checks. A UI that lists the
  Graph fields itself is a second copy of the matrix, and the first symptom of
  the drift is an operator filling in every box the page shows while the feature
  stays `credentials_missing`.
- **Credentials are write-only.** Sealed on the way in, never rendered back —
  the row reports which names hold a value. The audit line names the fields and
  not their contents, because a tenant's admins read that log.
- **Branding assets are storage paths, not an uploader.** A per-firm asset
  uploader did not fall out cheaply (bucket, path derivation, image validation,
  four slots), and text fields are honest about what the row holds. Flagged for
  a later pass.
- **`status` was checked before it was surfaced.** It is read in exactly one
  place, `forEachActiveFirm`, so suspending a firm pauses its crons and nothing
  else — not sign-in, not the portal. The panel says that instead of implying a
  kill switch, and the honest fix if a real one is wanted is a proxy check, which
  is a separate decision.
- **The lockout rule refuses the last operator outright.** No confirmation makes
  it safe: the person confirming cannot undo it, and recovery is a shell with the
  service-role key. Self-deactivation while others remain is allowed behind an
  explicit `confirmSelf` — recoverable, but irreversible for the person clicking,
  which is exactly the shape of click that should not happen by accident on a row
  in a list. The rule is pure and unit-tested; the probe asserts the route
  consults it.
- **Roster changes audit into every firm.** Granting operator access is firm-less
  in shape and not in effect, so `logOperatorAuditAcrossFirms(allFirmIds())` puts
  "this person can now read and edit your configuration" in each tenant's own
  log. Still no sentinel firm and `audit_log.firm_id` is still NOT NULL.
- **Every deny check sends a body that would have worked**, and the sweep is
  followed by assertions that nothing changed. A deny check whose body the
  validator rejects first passes with the guard deleted; a redirect that still
  performed the write is invisible to a status-only assertion. Both were easy to
  get wrong and are the reason the mutation half is table-driven.

**Flagged, not guessed:**

- **No branding-asset uploader.** Storage paths are text fields (see above).
- **`docs/guides/` was not updated**, for phase A's reason: its audience is a
  firm's own staff and `/platform` is not reachable by any of them. Operator
  documentation should be its own document.
- **The "last active operator" branch is not asserted by the probe.** How many
  operators the database has is not the probe's to control, and manufacturing
  that state would mean deactivating real ones. The branch is covered mocklessly
  in `lib/platform/operator-lockout.test.ts`; the probe proves the route consults
  the rule (`self_unconfirmed`).
- **`usePlatformEnv` stays operator-editable — decided 2026-08-24, not an open
  question.** It is a real per-firm declaration and the operator surface is where
  such a declaration belongs. Keep the blunt warning: it is the one toggle on
  this surface whose mistake causes a cross-tenant *filing* error rather than an
  outage, because lending the platform's Entra app to a firm that does not own it
  would file that firm's documents into the platform firm's SharePoint library,
  outside anything RLS can see. Do not re-raise; do harden the warning if the
  operator roster ever grows beyond people who know that.
- **Firm-detail page loads are audited per view**, like the list. Same volume
  trade-off phase A accepted.

---

## Seeded content is not part of onboarding (decided 2026-08-25)

**Firms fill their own resources.** The `resources` seed scripts
(`seed-guide-*`, `seed-playbook-*`, `seed-protocols`, `seed-style-guide`) are
dev and demo tooling, not product — they exist so a dev firm has something to
look at. They are deliberately **not** moving into the provisioning seed pack,
and a newly provisioned firm starts with an empty Resources library.

Two consequences worth keeping. Moving that content into `lib/` would turn
`verify:brand` red on contact: the literal firm names are gone, but the prose
still encodes one firm's opinions as the product's — specific typefaces, "we use
Notion and Outlook", a Style Committee, a named liaison roster. And
`seed-legal-writing-workshop` was deleted rather than repaired, since it loaded a
deck that left the repo in phase 0 as firm-proprietary; the content itself lives
in a private folder outside the repo.

If guided onboarding ever wants starter content, the work is writing neutral
content first — the mechanical part is easy and already proven by the seed pack.

---

## Where lumilex runs, and importing the origin firm (decided 2026-08-25)

**The origin firm's database stays separate and the origin firm keeps using the old app.** The two
codebases diverge from here, so the origin app needs its own database to keep
running. Lumilex is not migrating the origin firm off it.

**Lumilex runs on the current project** (`jmwcsldskeycpgqtbcyx`) — the wiped
former demo project. No third project. It is still a dev database today and
becomes production when the first outside firm is onboarded.

**There is no origin import, and no migration tool yet.** The origin firm keeps its own app
and database, so nothing needs to move. A rehearsal import was considered and
dropped: it would only have been practice, and practising against an invented
input format teaches you the wrong lesson. Onboarding tooling gets built when a
real firm arrives with real input — spreadsheets, another system, paper — because
that is what decides the shape of it. Expect several kinds of input over time
rather than one importer.

Consequence worth keeping: this database holds no client data at all right now,
which is why it is still a safe place to run the probe suite.

> **Superseded in part (2026-09-25).** The dev/prod split below is overtaken
> by "One codebase, one instance per firm": this project becomes the fleet's
> *test* instance and every firm gets its own. The reasoning is kept because
> it is why the test instance must never hold a firm's data.

**The trigger that ends this arrangement.** `npm run verify` provisions real
firms, auth users and storage objects and then deletes them — `rls-probe`,
`storage-probe` and `platform-probe` all do. The day a *paying* firm's data lands
in this project, that suite has nowhere safe to run, and those probes are the only
things that catch cross-tenant leaks (the `documents`/`receipts` storage leak in
§1 produced zero findings from every other gate, including `get_advisors`). So
**before the first outside tenant, split dev from production**: a new project for
production, this one stays the test bed.

**If a real firm's data is ever loaded here, revisit two things** that are moot
while the database is empty: privileged client data living in a database treated
as dev (whose service-role key sits in a local `.env.local`), and the dev/prod
split above. Also, any firm arriving with an existing SharePoint archive needs
its existing roots seeded into `settings.documents`, or already-filed documents
stop being reachable — see the `documentRoot` helper.

---

## Confidentiality: what we can honestly promise (planned 2026-09-01)

Law firms buy on confidence, so "encrypted" is a marketing claim before it is
an engineering one — and the two have to agree. This section is the plan, and
its first finding is that the obvious version of the ask is not buildable.

### End-to-end encryption and this product cannot both exist

E2EE has a specific meaning that a firm's security counsel knows: **content is
encrypted under keys the provider never holds**. Not in transit, not at rest
under our keys. If we can decrypt under subpoena, it is not E2EE, and saying
otherwise to a firm whose whole duty is client confidence is the kind of claim
that ends a company.

Lumilex holds every key, and that is load-bearing rather than an oversight:

- **Every page is server-rendered.** 142 `page.tsx` under `app/`, none of them
  `'use client'` at the page level. The server decrypts and renders; remove its
  read access and there is nothing left to send.
- **Analysis, briefs, summaries, drafting and red team all read plaintext** and
  call a third party. Claude cannot analyse ciphertext.
- **Semantic search dies outright.** Vectors are computed from plaintext and
  are partially invertible, so encrypting a document while storing its
  embedding is theatre, not security.
- **Crons have no user, so no user key.** Ten of them in `vercel.json`. The
  failure would be silent, which this codebase has already been bitten by twice.
- **Filtering and ordering on content stop working.** `ilike` and `ORDER BY` do
  not work on ciphertext.

The one piece of good news: uploads already go browser → Storage directly
through signed URLs (`lib/upload.ts`, `uploadToSignedUrl`), so encrypting file
*bytes* in the browser needs no route changes.

**Conclusion: E2EE is a mode, not a setting.** Worth building for matters that
ask for it; not worth making the default, which would gut what firms are buying.

### The gap that was actually exposed — closed, see below

The real hole was never the missing encryption: **client documents already left
the building** — `lib/ai/auto-analyze.ts` to Anthropic, `lib/ai/embeddings.ts`
to Voyage — and a firm had no way to discover it, refuse it, or turn it off.
That is the finding a security reviewer surfaces first, and it lands much worse
next to a confidentiality pitch. It is closed as of the AI-opt-in work below.

### The four tiers, in order

1. **Tier 0 — say true things.** A subprocessor and data-flow disclosure,
   zero-retention terms with Anthropic and Voyage, and per-firm AI opt-out.
   *The opt-out half is DONE (below); the written disclosure is not, and is the
   prerequisite for every claim under it.*
2. **Tier 1 — envelope encryption at rest, per firm.** A per-firm data key
   wrapped by a platform master key, over storage objects and a named set of
   high-sensitivity columns. The app still decrypts, so every feature survives,
   but a leaked backup, a dashboard session, a log line or a compromised
   Postgres role yields ciphertext. Best safety per unit of work, and the right
   first build. `lib/firm/secrets.ts` already holds correct, boot-validated
   AES-256-GCM to extend. **Two things to price in before starting:** the
   migration of existing rows, and the loss of direct signed-URL previews —
   `app/api/file-sign/route.ts` becomes a proxy, which is a real latency
   regression, not a footnote. Pick the encrypted column set deliberately:
   bodies, analyses, summaries, chat, notes — never anything joined, filtered
   or sorted on.
3. **Tier 2 — customer-managed keys.** The firm's KEK in its own KMS, so it can
   revoke unilaterally. Slots into `firm_integrations`, which is already the
   BYO-credential mechanism. Unwrap caching needs a hard TTL or revocation is a
   claim rather than a control. This is what enterprise legal buyers actually
   ask for — far more often than E2EE.
4. **Tier 3 — sealed matters.** Real E2EE, per matter, encrypting in the
   browser ahead of the existing signed-URL PUT. That matter gives up AI,
   search, previews, server-side document generation, crons and the portal, and
   the UI must say so where the flag is set. **Design the recovery story
   first**: a firm that loses a matter key has destroyed client files, which is
   a malpractice event, not a support ticket. A firm-held escrow key is the
   honest answer and it caps the claim, so it must be disclosed.

**Tiers 2 and 3 wait for a named firm to ask.** Both are answers to procurement
questions; building them speculatively spends months on a claim nobody has yet
made. Tier 1 is the only one whose value does not depend on being asked for.

**When Tier 1 lands it needs a gate** — `verify:crypto`, beside `verify:rls`
and `verify:storage`: no plaintext in a covered column, a wrong-key open fails
closed, rotation exercised. An encryption invariant with no probe decays
exactly like an RLS one.

---

## AI is opt-in, per firm, per surface — DONE (2026-09-01)

Every path that sends firm content to a third-party model is now behind a
feature key, and a firm that has not opted in is refused by a function that
will not run.

**Four new keys**, because they are four different consents:

| key | what leaves | to |
| --- | --- | --- |
| `ai_analysis` | stored matter and client documents | Anthropic |
| `ai_search` | firm content, embedded and stored as vectors | Voyage |
| `ai_assistant` | staff assistant and matter chat | Anthropic |
| `ai_client_chat` | AI answering the firm's *clients* in the portal | Anthropic |

Splitting them is the point. Enabling `portal` is not consent for a model to
answer your clients; a one-shot read is not the same disclosure as a durable
derived copy at a second subprocessor. `drafting`, `red_team` and `issuances`
predate this group and keep their own keys.

### The gate, and why it had to be one

There was **no chokepoint**: twenty-two files each built their own
`new Anthropic({ apiKey })`. So "ask before sending this firm's content
somewhere" was a convention — which is exactly what `firm_id` stamping was
before `getServiceDbForFirm` made omitting it impossible, and that shipped
broken four times.

- **[lib/ai/gate.ts](../lib/ai/gate.ts)** is now the only place a model client
  is constructed. `anthropicFor({ firmId, feature })` resolves the feature and
  throws `FeatureDisabledError` when the firm has not opted in. `firmId` is
  required and has no default — a default would repeat the `firm_id` column
  mistake, succeeding under the wrong firm instead of refusing.
- **`anthropicForPlatform(reason)`** covers work with genuinely no firm behind
  it, against a **closed union** of reasons: `issuances_extraction` (public
  government material, scraped once and fanned out) and
  `claude_files_maintenance` (the Files API store is keyed by
  `ANTHROPIC_API_KEY`, so it is platform-wide). It is not a bypass — it exists
  so "no client outside the gate" stays literally true and the exceptions stay
  countable. One exempt *file* would have become two.
- **Voyage** is gated in `lib/ai/embeddings.ts`, the only module allowed to
  call it. The **read** path is gated too and before `embedQuery`, because the
  query string is itself firm content; it returns `[]` rather than throwing,
  since a firm without the feature has no vectors either and a background
  retrieval must not 500. The **write** path throws — that is where content
  becomes a stored copy at a third party, and a silent skip there would look
  exactly like an idle backfill.
- **`npm run verify:ai-gate`** ([scripts/audit-ai-gate.ts](../scripts/audit-ai-gate.ts))
  is the ratchet, in the chain after `verify:firm-id`. Deliberately syntactic
  and dumb: it greps for the SDK constructor and the Voyage entry points, so it
  cannot be argued with and a new call site fails until somebody routes it
  through the gate. The allowlist is grouped by reason and is six maintenance
  scripts plus `embeddings.ts` itself.

### What this changed at the edges

- **`20260901_ai_feature_keys.sql`** registers the four keys for every firm,
  **disabled** — the provisioning rule, and the intended effect of "opt-in".
  `on conflict do nothing`, so a re-run never un-does an operator's decision.
  New firms get the rows from `ensureIntegrations`, which iterates
  `FEATURE_KEYS`.
- **UI is suppressed, not disabled**, per the existing rule: nav entries for
  Knowledge, Knowledge Base and Affidavit Review are gated, the assistant
  launcher in `DashboardShell` renders only with `ai_assistant`, and the four
  pages redirect server-side — nav suppression is not a gate.
- **`AI_FEATURE_KEYS` includes `issuances`** even though it discloses nothing,
  because it still constructs a client and the ratchet only holds if every
  client goes through the gate.

### Found while doing this, and fixed

**`/api/admin/claude-files` was unauthenticated.** `api/admin` is excluded from
the proxy matcher, so routes under it do their own session check — and this one
did none, on a handler that lists *and deletes* Claude Files API content across
every tenant. It now requires a session and `super_user`. That prompted the
sweep below.

---

## The route auth sweep (2026-09-01)

All 472 handlers across 285 route files under `app/api`, checked per *handler*
rather than per file — a route can guard one method and not another.

**Two real holes, both fixed.**

**`/api/file-analysis/auto` had no auth of any kind.** `api/file-analysis` is
proxy-excluded, the handler took an arbitrary `fileId`, and with no `firmId` it
resolved the file through the **raw service-role client** — across every firm.
So anyone who could guess a `notion_id` could trigger AI analysis on another
tenant's document: platform credit spent, and that firm's file shipped to
Anthropic without its consent. The infuriating part is that the DB webhook
(`call_app_api`) has always sent `Authorization: Bearer <cron_secret>` from the
vault — **the route simply never looked**. It now checks that header, or a
session; a session pins the scope to its own firm and a caller-supplied
`firmId` is ignored for it, since trusting one would let firm A name firm B and
reach the unscoped branch. Adding `CRON_SECRET` put it in `verify:cron`'s
population, so it is listed in `ENTITY_SCOPED` with its reason — it is a
per-row webhook, not a fan-out cron.

**`/api/admin/file-upload` authenticated but did not authorize.** POST and
DELETE took any signed-in staff member, then wrote through the service-role
client with no matter-access check — so a liaison officer could append to or
delete attachments from any `files` row in the firm. Every sibling
(`file-bulk-create`, `signatures`, `[entity]`, `batch-import`) requires
`['admin', 'super_user', 'finance']`, and proxy.ts already limits the only UI
that reaches it to exactly those roles. It was the API being more permissive
than its own front end — the UI-only gating the RBAC section warns about. Now
gated like its siblings. Checked first that no other caller breaks: `AddRowModal`
also lives in chat quick-create, which every role can open, but its file
dropzone renders only when an entity declares a `type: 'files'` field and the
only entity that does is `files`, which is not a quick-create entity.

**Everything else was a false positive**, and worth recording because the first
two passes of the scan produced 25 then 11 phantom findings:

- A handler signature like `export async function GET(req, { params })` makes a
  naive brace-matcher read the destructured `{ params }` as the function body.
  Paren-match the parameter list *first*, then take the body brace.
- A helper declaring `Promise<{ ... }>` as its return type has the same effect
  one level down, which hid `requirePortalSession` behind four portal routes.
- Guards are not all named `getSession`. `requirePortalSession`,
  `requireOperator` and a `CRON_SECRET` bearer check are all real gates.

**The five genuinely unauthenticated handlers are all intentional**, and all
already documented: `/api/calendar/[token]` (bearer token in the URL, by
construction), the two `/api/dev/*-signin` impersonation routes (404 unless
`NODE_ENV === 'development'`), `/api/public/brand/[firmId]/[asset]` (slot
validated against an enum, object key from server config and never from the
request), and `/api/public/intake` (zod per form kind, honeypot, per-IP
throttle, per-email daily cap, quarantined in `intake_submissions`).

### The ratchet — `npm run verify:route-auth`

[scripts/audit-route-auth.ts](../scripts/audit-route-auth.ts), in the chain
after `verify:ai-gate`. Every exported handler under `app/api` must establish a
caller, or be named in `ALLOWLIST` with the reason it does not. 472 handlers,
285 route files, 5 allowlisted.

- **The allowlist is keyed `<route> <METHOD>`, not per file.** Adding a POST to
  a route whose GET is unauthenticated by design fails until somebody says why.
  A file-level allowlist would have silently blessed it.
- **A handler it cannot read is a failure, not a pass.** If the scanner meets a
  form it does not recognise — a re-exported handler, say — it reports it and
  exits 1, and the fix is to teach the parser rather than to allowlist the
  route. A checker that silently drops what it cannot parse is worse than none,
  because the run stays green.
- **It answers "is there a caller", not "is the authorization right".** Those
  are different questions and only the first is mechanisable.
  `/api/admin/file-upload` is the proof: it authenticated perfectly and still
  let any signed-in staff member delete any firm file, because it never checked
  a role. A green run here is not a claim that every handler authorizes
  correctly.
- **Stale entries warn rather than fail**, matching `audit-service-role.ts` and
  `cron-probe.ts`. The known trade-off: an entry whose route was deleted and
  later recreated by someone else would arrive pre-approved.

Six negative controls were run against it, because a ratchet nobody has seen
fail is decorative: an unauthenticated route fails; the same route with
`getSession` passes; a handler with destructured params calling a helper that
declares a braced return type passes (both parser traps above, which together
had produced 18 phantom findings); a re-exported handler is reported as
unreadable rather than passing; a POST added to a file whose GET is allowlisted
fails; and a stale entry warns.

### Not done

- The **written disclosure** (Tier 0's other half) — a subprocessor page and
  data-flow document. The switch exists; the thing a firm reads before flipping
  it does not.
- **Zero-retention / no-training terms** with Anthropic and Voyage.
- ~~`firm_integrations` still holds orphaned `email_autopilot` and `graph_mail`
  rows from deleted features~~ — **DONE (2026-09-04)**,
  `20260904_drop_orphaned_feature_rows.sql`. Two rows, both the dev firm's,
  neither holding a credential. The same migration strips the four dead keys
  (`telegram`, `graph_calendar`, `graph_mail`, `email_autopilot`) that the
  2026-08-29 drop left `true` in `firms.settings.features`; `graph_mail` also
  came out of `GRAPH_FEATURES` in `lib/microsoft-graph.ts` and out of the RLS
  probe's fixture, which now seeds `sharepoint` for the same deny checks.

---

## One shared instance, configured per firm (decided 2026-09-04)

> **Superseded (2026-09-25)** by "One codebase, one instance per firm" below.
> The configuration rule survives unchanged; the topology does not.

Lumilex is sold as consulting — implementation and training for Philippine law
firms — not as a SaaS product. That is a business fact with an architectural
consequence, and the consequence is not the one it first looks like.

**The topology stays what it already is: one instance, many firms.** The
alternative — a Supabase and Vercel project per firm — was considered and
dropped. It would have demoted `firm_id` and RLS to defence in depth, made
`/platform` a control room over a single tenant, and turned every upstream
security fix into N deploys. Onboarding is meant to change data, not code, and a
per-firm deployment is a standing invitation to change code.

**So the tenancy machinery is the primary boundary, and its gates are
load-bearing.** `verify:rls`, `verify:storage`, `verify:firm-id` and
`verify:service-role` are what stands between two paying clients' privileged
matter files. Under a per-firm topology they would have been belt-and-braces;
under this one they are the belt.

**The rule that follows: a firm's difference is configuration, edited on
`/platform`.** When a firm needs something different, the first question is
which existing seam holds it — `firms.branding`, `firms.settings`,
`firm_integrations`, `FEATURE_KEYS`, the seed pack, `firm_invoice_settings`. If
none does, the answer is a new firm-scoped setting **plus an editor on
`/platform`**, never a per-firm branch and never an env-var switch. A consulting
business dies on N forks that cannot take an upstream fix; this is the rule that
prevents it, and it only holds if it is applied the first time it is
inconvenient.

**This makes the dev/prod split above a hard gate rather than a note.** See
"Where lumilex runs" — the three probes provision and delete real firms, auth
users and storage objects in whatever project they run against. Split before the
first paying firm's data lands.

---

## One codebase, one instance per firm (decided 2026-09-25)

Reverses the topology half of the 2026-09-04 decision above. Every firm gets
its own Supabase project and its own Vercel project, all built from this one
repo and one branch. The rule that a firm's difference is configuration stands
exactly as written.

**Why the reversal.** The earlier decision counted "`firm_id` and RLS demoted
to defence in depth" as a cost. Weighed against the consulting model it is the
benefit:

- **Blast radius.** With every firm in one database, one policy mistake is a
  leak between two paying clients' privileged files. With a project per firm,
  the same mistake exposes nothing, because the other firm's rows are not
  there.
- **What a firm can be told.** "Your firm has its own database and its own
  keys" is a claim a managing partner can check. It gives Tier 1 encryption a
  per-project key for free, makes Tier 2 customer-managed keys close to free
  (the firm can own the project outright), and turns offboarding into handing
  a project over.
- **The cost it was avoiding is tooling, not forks.** N deploys from one
  branch is a fleet run, not N codebases. What makes a fork is a per-firm
  branch, and the configuration rule still forbids that.
- **The dev/prod split dissolves.** The current project becomes the test
  instance. No firm's data lands in it, so the probes keep a safe home
  permanently rather than until the first tenant.

**What does not change.**

- **A firm's difference is configuration**, on the existing seams plus an
  editor on `/platform`. Per-instance deployment makes forking *easier*, so
  this rule matters more now, not less.
- **The tenancy machinery stays, and its gates stay in `verify`.** The test
  instance holds several firms at once on every probe run, and a firm's
  instance runs the identical code. In production the boundary is now the
  project; `firm_id` and RLS are the second line. A red probe is still a bug.
- **`/platform` stays, per instance.** On a firm's instance it is where that
  firm's configuration is edited, and the operator is us.

**The fleet tooling (built 2026-09-25).**

- **[fleet/instances.json](../fleet/instances.json)** lists every instance:
  slug, `test` or `firm`, Supabase project ref, Vercel project, primary
  domain. It holds no secret. [lib/fleet/manifest.ts](../lib/fleet/manifest.ts)
  validates it: exactly one test instance, one project per slug, and the origin app's
  production project refused by the hash of its ref.
- **[supabase/migration-versions.json](../supabase/migration-versions.json)**
  records the version each migration file was applied under on the test
  project. Replay order comes from it, not from filenames:
  `YYYYMMDD_description.sql` sorts alphabetically within a day, which puts
  `20260822_firm_allocators.sql` ahead of `20260822_firms_foundation.sql` and
  `20260822_firm_id_wave.sql`, both of which it depends on. The versions are
  the same ones the ledger holds, so an instance's applied set is read straight
  from `supabase_migrations.schema_migrations`. A unit test fails while any
  file lacks an entry.
- **[scripts/fleet-migrate.ts](../scripts/fleet-migrate.ts)**
  (`npm run fleet:migrate`) reports what each instance is missing, and with
  `--apply` brings them current: the test instance first, firms refused while
  it has anything pending, one transaction per migration together with its
  ledger row, stop at the first failure. It refuses a pending migration older
  than one already applied, a connection string that does not name its own
  project, and a firm with an empty ledger unless `--bootstrap` is passed.
  Connection strings come from `FLEET_DB_URL_<SLUG>` in the environment or a
  gitignored `.env.fleet`; TLS verifies against the CA named by
  `FLEET_DB_CA_CERT`.
- **Four ledger rows on the test instance map to no file**:
  `firm_id_insert_refusal_probe_pin_sequences`,
  `firm_id_insert_refusal_probe_final`,
  `deliverable_status_is_finalized_pin_search_path` and
  `revoke_call_app_api_trigger_grant`. Each amended a migration applied
  minutes earlier, and each was folded into that migration's file — confirmed
  by comparing the recorded SQL. The script lists them as info.
- **One ledger row was renamed to match its file.**
  `20260926_revoke_trigger_function_execute.sql` was applied under the name
  `20260926_revoke_trigger_function_execute`, date prefix included. That is a
  name mismatch, which refuses the test instance and so every firm. The row
  (`20260926114000`) was renamed to `revoke_trigger_function_execute` on
  2026-09-28, after its recorded SQL was checked against the file.

**Open before the first firm instance.**

- **Fresh-instance bootstrap is proven (2026-11-01).** `npm run db:bootstrap`
  ([scripts/bootstrap-database.ts](../scripts/bootstrap-database.ts)) replayed
  the baseline and all 60 migrations onto an empty local Supabase stack with no
  failure. A catalog fingerprint matched the test instance on columns,
  constraints, indexes, policies, grants, RLS flags, views and triggers. The
  only differences were what Supabase's platform version adds (a storage
  trigger, Realtime's message partitions), the demo's hand-installed
  `demo-golden` bucket, and a comment inside `cascade_team_rename`. The
  RLS, storage, platform and live cron probes then passed against that
  instance, 156/84/66/12. The local stack is free, so the billed throwaway
  project this item asked for was not needed.
- **The development firm is removed after replay** — the cheap fix, chosen.
  `firms_foundation` and its neighbours still seed `dev`, and `db:bootstrap`
  deletes it and the 13 rows it owns (its two `firm_domains` and eleven
  `firm_integrations`), so `localhost` is free for the firm provisioned next.
  `--keep-dev-firm` keeps it. A re-baseline without it remains the clean fix
  and still retires the ordering problem.
- **Renaming migration files to their versions** (`<14 digits>_name.sql`,
  the Supabase CLI's own convention) would make the version map unnecessary.
  It touches about 40 references across docs and code, so it was not done as
  part of the tooling. A re-baseline is the natural moment.
- **Vercel.** One project per firm, every one building `main`. Platform keys
  (Anthropic, Voyage, Resend, Firecrawl) as team-level shared variables;
  per-project Supabase keys, `CRON_SECRET`, `APP_BASE_URL` and
  `INTEGRATION_CREDS_KEY`. The last must be distinct per instance, or one
  leaked key opens every firm's sealed credentials.
- **A per-firm cutover checklist**, run once per client: the provisioning
  config, the Supabase dashboard tasks in
  [auth-migration-followups.md](auth-migration-followups.md), the first
  operator, DNS, and the Resend sending domain.

---

## The fleet console: deploying an instance from an engagement (planned 2026-09-27)

**The goal.** A dashboard for us, the consultancy, that deploys a new firm's
instance and configures it from the engagement signed with that firm. Choose
the client, choose the terms, deploy — instead of hand-writing a provisioning
JSON, creating two cloud projects, pasting environment variables and running
scripts. It follows from "One codebase, one instance per firm" above: once each
firm has its own instance, standing one up is the unit of onboarding work.

### What already exists, and becomes its engine

Nothing here is throwaway. Each piece keeps its logic in `lib/` so a UI can
call it the way `/platform/firms/new` already calls `provisionFirm()`.

- **Fleet registry and schema rollout**: [fleet/instances.json](../fleet/instances.json)
  and `npm run fleet:migrate`. The console replaces the JSON file with a table
  and the CLI with a button, over the same planner in
  [lib/fleet/migrations.ts](../lib/fleet/migrations.ts).
- **What a valid firm is**: `provisionConfigSchema` in
  [lib/provisioning/config.ts](../lib/provisioning/config.ts) and
  `provisionFirm()` in [lib/provisioning/provision.ts](../lib/provisioning/provision.ts).
  The config already carries identity, domain, invoice prefix, first admin,
  branding, email, documents and entitled features.
- **What an agreement grants**: `FEATURE_KEYS` entitlements in
  `firms.settings.features`, including the four AI consents.

### Design decisions

- **The console is its own app, not part of `/platform`.** It will hold the
  Supabase management token and the Vercel token — credentials that can create
  or delete every firm's project. Those must never sit inside an instance a
  client's staff sign in to. `/platform` stays per instance, as the place that
  instance's configuration is edited.
- **An engagement becomes a named, versioned profile.** It records what the
  agreement grants: features and AI consents, starter content, default
  branding, integrations to register. Most of it is the provisioning config
  already; the new part is naming it and tying it to the agreement it came
  from, so "what did this firm buy" has one answer.
- **Entitlement stays separate from the switch.** The profile sets entitlement
  (`firms.settings.features`). Registration and credentials stay the firm's or
  the operator's, after the integration is actually connected — the
  three-level feature model already encodes this, and a signed agreement is not
  a working SharePoint connection.
- **Changing an engagement later goes through the instance's own operator
  API**, not direct database writes. That keeps one definition of a valid firm
  (the schemas above) and lands an audit row in that firm's own log, as every
  operator change does today.
- **Every instance runs the same code.** The console may pace a rollout (test
  instance, then one firm, then the rest) but never deploys a different build
  to one client. A per-client build is the fork this whole design exists to
  prevent.
- **Per-instance secrets are generated at deploy and not kept.** The console
  mints `INTEGRATION_CREDS_KEY` and `CRON_SECRET` for the new Vercel project and
  does not retain them — if it did, one breach of the console would open every
  firm's sealed credentials.
- **A firm may own its project.** Customer-managed keys (Tier 2 above) push
  toward the firm owning its Supabase project with us holding delegated
  access. The console should treat "we host" and "they host, we operate" as two
  modes of one deployment, not assume it owns every project.

### Stages, in order

Each stage ends with something that works on its own.

1. **Deploy the first firm by hand**, with the scripts that exist:
   create the projects, `fleet:migrate --apply --bootstrap`, `provision-firm`,
   the Supabase dashboard tasks in
   [auth-migration-followups.md](auth-migration-followups.md), DNS and the
   Resend domain. This is also what proves the fresh-instance bootstrap, which
   is still unproven, and settles the dev-firm seeding question. Write the steps
   down as the cutover checklist while doing them.
2. **Script instance creation as a CLI**: Supabase Management API for the
   project, Vercel API for the project and its variables, then the migrate and
   provision steps already scripted. The checklist from stage 1 is its
   specification. Exit: a second firm deployed with one command plus DNS.
3. **Engagement profiles as data**: the named, versioned profile, and the
   operator-API path for changing a deployed firm's entitlements. Exit: a
   firm's features match its agreement, and a changed agreement is one edit.
4. **The console UI** over stages 2 and 3: deploy, list instances with schema
   version and health, roll out migrations, change an engagement.

Building the UI first would encode guesses that the first real deployment
would correct. Stage 1 waits for a real client, the same rule as the
onboarding tooling above.

### Open questions

- Which Supabase organization and Vercel team own client projects, and how
  their cost is passed through to the engagement.
- Who holds DNS for a firm's domain — us, or the firm with records we hand
  them.
- Whether a profile version is pinned per firm (the terms they signed) or
  follows the latest version of that engagement type.
- Offboarding: handing a firm its project, or exporting its data, when an
  engagement ends.

### Three hosts, and the order to get there (decided 2026-09-30)

| Host | What | Where it lives |
| --- | --- | --- |
| `lumilex.co` | the marketing site, with "Try the demo" | its own repo and Vercel project — never a route here, or it ships to every firm |
| `demo.lumilex.co` | the public demo (below) | this repo, `lumilex-demo`, on the test project |
| `admin.lumilex.co` | the fleet console | its own app, its own small database — never inside an instance, because it holds the tokens that create and delete every firm's project |

Firm instances sit on their own hosts beside these.

**Order, each step working on its own:**

1. **Demo live** — merge, deploy, DNS.
2. **Marketing site** at `lumilex.co`, linking to `https://demo.lumilex.co` (per
   role with `?as=partner` and the rest).
3. **Stage 1 on a staging instance rather than a client.** This reverses "stage
   1 waits for a real client" above: the demo shares the test project, so it
   proved nothing about a fresh one, and the fresh-bootstrap and dev-firm
   questions should be settled before a client depends on the answer. A
   `staging` firm instance on a new project, built by hand, checklist written
   as it goes.
4. **Stage 2** (`create-instance`), then **stage 3** (engagement profiles),
   then **stage 4**, the console UI at `admin.lumilex.co`.

**Where keys go, so the console is never one breach that opens every firm:**

- **Platform keys** (Anthropic, Voyage, Resend) are Vercel team-level shared
  variables; the console never handles them per firm.
- **Per-instance secrets** (`INTEGRATION_CREDS_KEY`, `CRON_SECRET`) are generated
  at deploy, written to that Vercel project, and not kept.
- **A firm's own credentials** go through that instance's `/platform` operator API,
  which seals them in the firm's database; the console passes them and keeps
  nothing.

**Roles.** Provisioning already creates the first admin. A roster — people and
their roles — is new, belongs in the engagement profile, and is applied through
the same instance API, so there is still one definition of a valid team row.

**Decisions this needs, before step 3:**

- **lumilex.co's DNS moves from GoDaddy to Vercel**, so the apex, `demo`, `admin`
  and any firm subdomain are added in Vercel — and, later, by the console
  through the API — instead of a GoDaddy record each.
- **A Vercel Pro team.** Hobby is for non-commercial use, the five-minute crons
  need Pro, and Hobby blocked a deploy whose commit carried a co-author
  outside the team.
- **A Lumilex Supabase organization** for the test project and every project the
  console creates — and how each firm's project cost passes
  through to its engagement (above).
- **Firm hosts:** a firm's own domain (`app.theirfirm.ph`), a `theirfirm.lumilex.co`
  subdomain, or either per firm. Subdomains are what the console can do
  unattended once DNS is on Vercel.

---

## The demo instance: demo.{domain} (planned 2026-09-30)

**The goal.** A public, always-working Lumilex at `demo.{domain}`, reached from
a "Try the demo" link on the marketing landing page at `{domain}`. A visitor
picks a role, lands in a fictional firm's full workspace — matters,
deliverables, billing, the Library, Search — and nothing they do reaches a
real person or survives the night. `{domain}` is not chosen yet: the Vercel
team owns two unrelated domains, no Lumilex domain, and there is no
marketing site in any repo.

**It is also stage 1 of the fleet console, rehearsed.** The console plan above
starts with "deploy the first firm by hand", which is what proves the
fresh-instance bootstrap and writes the cutover checklist. The demo is the same
work with nothing at stake: the first instance built from an empty project,
through `fleet:migrate --bootstrap` and `provisionFirm()`. Everything it
exposes is fixed before a paying firm depends on it.

### What exists today, and why it doesn't count

- **`lumilex-demo` on Vercel** (`lumilex-demo.vercel.app`) was deployed by hand
  from the CLI on 5 and 7 August, before the fork, from the origin app's
  `claude/demo-instance-dummy-data-9e8789` branch. It has no Git link. Its
  bundle points at Supabase `jmwcsldskeycpgqtbcyx` — the old "Lumilex Demo"
  project, which was wiped and is now the **test instance**. So August code is
  running against a September schema, and the probes provision and delete
  whole firms in that database on every run. It answers with a login page; the
  rest is presumed broken. **Take it down or repoint it first** (stage 1).
- **A fictional firm's dataset** survives on that origin-app branch:
  `scripts/seed-demo.ts` (a 14-person firm across every role, 18 clients, 30
  matters, 95 deliverables, hearings, meetings, eight weeks of time,
  invoices, corporations, trademarks, errands, chat),
  `scripts/seed-demo-files.ts` (~380 generated documents with invented
  pleading text, wired into version history), and a judicial affidavit
  fixture. It predates the rework: it writes with no `firm_id`, feeds tables
  since dropped (attendance, evaluations, the email inbox) and brands through
  `NEXT_PUBLIC_FIRM_*` env vars, which `firms.branding` replaced. The content
  is worth porting; the plumbing is not.
- **What that branch learned about fresh projects**, and still true: the
  Vault must hold `app_base_url` and `cron_secret`, or the three triggers that
  call `call_app_api*` roll back their whole statement and every file analysis
  sits in `processing` forever; and bucket *policies* are not bucket contents
  — no object from any real firm's storage goes near a public demo.

### Design decisions

- **Its own Supabase project and its own Vercel project, like a firm.** Never
  the test instance: the probes delete firms there. The demo is listed in
  [fleet/instances.json](../fleet/instances.json) with a new role, `demo`,
  migrated after the test instance and before any firm — a canary that real
  people click through every day. `lib/fleet/manifest.ts` learns the role.
- **Every instance runs the same code.** The demo builds `main`. Its difference
  is configuration on the existing seams — a fictional firm's `branding`, its
  feature entitlements — plus the demo guardrails below. No demo branch, ever;
  the old demo was exactly that, and it is why it cannot be updated.
- **`demo.{domain}` is the demo firm's primary domain and the instance's
  `APP_BASE_URL`.** One `firm_domains` row, so the host binding and branding
  work as they will for a firm. `/platform` answers there too, for us.
- **The marketing site is its own project at `{domain}`, not a route in this
  repo.** Every firm's instance builds this repo; a landing page in it ships
  to every client. The only contract between the two is the demo's own root:
  `https://demo.{domain}`, optionally `?as=partner`. The host already says
  "demo", so there is no `/demo` path under it.
- **Visitors get in with one click, as a persona.** On a demo instance the
  login page *is* the role picker: an anonymous visitor to `/` is already sent
  to `/login`, and there it sees the roles — Partner, Lawyer, Finance, Admin,
  Liaison — with a small "Sign in with a password" link for operators, since
  `/platform` answers on this host too. That redirect drops the query string
  today, so it has to carry `req.nextUrl.search` for `?as=` to survive it.
  Choosing a role signs the visitor in as that
  persona's account: the server mints a session through the Supabase admin API
  (a magic-link token it verifies itself), so no password exists to publish,
  share or change. Guarded three ways, because this is a login that asks no
  secret: the firm's `settings.demo` must be on (set on `/platform`, badged in
  the firm list), the account must be one of the firm's registered personas,
  and the deployment must declare itself a demo (`LUMILEX_INSTANCE_ROLE=demo`).
  The last is an env var on purpose — a safety interlock that a mistaken
  `/platform` edit on a real firm cannot flip, not a per-firm customization.
  It is the one such exception and gets written into CLAUDE.md as one.
- **Everyone shares one firm, and it resets nightly.** Simplest, and it shows
  what the product is — a shared workspace. The reset restores a **golden
  snapshot**: a data-only dump of the demo project taken right after seeding,
  so a reset costs no AI calls and takes seconds, and it removes every object
  a visitor uploaded. The snapshot is retaken after any migration touches
  seeded tables. A per-visitor firm is possible later — the tenancy machinery
  is built for exactly that — but seeding ~380 documents per visitor is not.
- **The reset does not run from `vercel.json`.** A cron there ships to every
  firm's instance, and a job that restores a database is the last thing that
  should exist, even guarded, on a client's deployment. It runs outside the
  app: a scheduled GitHub Actions workflow (the repo has none yet) holding
  only the demo project's credentials, or the same script run by hand until
  that exists.
- **Nothing leaves the demo.** No `RESEND_API_KEY` on the project — every
  send in `lib/email.ts` already skips or refuses without it, so the platform
  key must not be attached as a shared team variable here. Supabase Auth's own
  mailer is the remaining path: user management, portal invitations and
  password changes are refused for a demo firm, and the Auth project gets no
  custom SMTP and no signups. No SharePoint, no push.
- **AI is on, pre-generated, and capped.** The features that sell the product
  are AI: the brief, file analysis, Search, the distilled Library pages,
  Drafting Studio, Red Team. So the demo firm has every AI consent on, the
  seed runs analysis, embeddings, briefs and a Library backfill once (the
  golden snapshot keeps them), and live generation is rate-limited per session
  with a daily firm budget, after which the buttons say the demo's allowance
  is spent. Needs `VOYAGE_API_KEY` and `ANTHROPIC_API_KEY` on the project.
- **The rest of the abuse surface.** Uploads capped in size; `noindex` on the
  host; the Rules of Court imported; an in-app banner — "You're in the Lumilex
  demo. Everything resets at 3:00 AM" — with a way back to `{domain}`. A
  CAPTCHA on the role picker only if bots show up.

### Stages, in order

Each stage ends with something that works on its own.

1. **Stop the old demo pointing at the test instance.** Remove its production
   deployment or password-protect it, and repoint nothing until stage 3. Five
   minutes, and it closes a public app fronting the probes' database.
2. **Bootstrap a fresh project** (billed — a deliberate step, ~$10/month for
   the smallest compute). Settle the dev-firm question from "One codebase, one
   instance per firm" first: a re-baseline without the dev firm's rows, or a
   cleanup step after replay. Then `fleet:migrate --apply --bootstrap`, the
   Vault secrets, the Auth settings from
   [auth-migration-followups.md](auth-migration-followups.md), and an
   object-for-object schema diff against the test instance — the old branch's
   `fingerprint.sql` is the starting point. Exit: identical schema, written
   down as the cutover checklist.
3. **Deploy.** Link the `lumilex-demo` Vercel project to this repo's `main`,
   replace every environment variable (the old ones name the test project),
   add `demo.{domain}`, set `APP_BASE_URL`, list the instance in the fleet
   manifest, `provisionFirm()` the demo firm from a committed config, first
   operator. Exit: an operator signs in at `demo.{domain}` and sees an empty
   fictional firm in its own branding.
4. **Content.** Port the origin app's seed and document generator onto
   `getServiceDbForFirm` and the current schema; handbook guides through
   `runSeed`; the Rules of Court; one AI pass; take the golden snapshot and the
   reset script. Held to the seed pack's rules — no real person, firm, client
   or price, checked by `verify:person-shaped` and by hand. Exit: a reset
   restores the whole firm, AI output included.
5. **Visitor access and guardrails.** The role picker, the persona sign-in, the three
   guards, the refused account actions, the AI budget, the banner, the nightly
   reset. A probe for the guards: persona sign-in refused on the test instance
   and on a firm without `settings.demo`, refused for a non-persona account,
   and every refused action actually refused. Exit: a stranger can use it and
   break nothing that survives the night.
6. **Link it.** The marketing site's "Try the demo" points at
   `https://demo.{domain}`. Building that site is its own piece of work.

### Built (2026-09-30) — and where it departs from the plan above

The runbook is [demo-instance.md](demo-instance.md); the editing rules are in
CLAUDE.md → "The public demo". Stage 1 was done by hand before this. Three
decisions changed on the way, all on the owner's call:

- **No project of its own.** The demo firm lives on the test project
  (`jmwcsldskeycpgqtbcyx`), beside the dev firm and the probes' disposable
  firms, which only ever delete `probe-*` slugs. So stage 2 — proving a fresh
  bootstrap — is still open, and the demo is not a separate canary in the
  migration order: it rides the test project, which is migrated first anyway.
  `fleet/instances.json` records `lumilex-demo` and `demo.lumilex.co` on the
  test entry rather than as a `demo` role.
- **`{domain}` is `lumilex.co`** (GoDaddy DNS). The firm is **Lumilex & Partners**,
  which cannot collide with a real firm; the old dataset's "Castillo Reyes &
  Partners" sat too close to Castillo Laman Tan and Castillo & Bello.
- **The reset runs inside the project, not from GitHub Actions.** Sharing the
  test project rules out a whole-database restore, so the snapshot is
  firm-scoped: `demo_snapshot.take()` copies the demo firm's rows from every
  tenant table, `restore()` puts them back with dates moved to today, and a
  `demo-reset` edge function does the storage half (golden copies in a
  private bucket). pg_cron calls it with a secret only the Vault holds, so no
  credential leaves the project. None of it is a migration.

Also found and fixed on the way: `/api/auth/set-password` looked its target up
by email across every firm and never checked the caller's firm, so a partner at
one firm could set another firm's user's password. Moot on a single-firm
instance, live on the test project the demo shares.

Left open: upload size caps; the marketing site (stage 6); retaking the
snapshot is manual after a migration that touches seeded tables.

### Open questions

- **The domain.** What `{domain}` is, who registers it, and whether DNS moves
  to Vercel.
- **The Supabase organization.** The demo — and every firm after it — belongs in
  a Lumilex organization; decide before stage 2 creates the project.
- **The fictional firm's name.** The old dataset used an invented firm; check
  whatever name is chosen against the IBP roll and the SEC before it goes on a
  public site.
- **AI budget.** The per-session and daily limits, and whether the most
  expensive surfaces (Drafting Studio on the complex model) stay live or show
  a pre-generated result.
- **Which roles to offer.** Partner, Lawyer and Finance tell the story;
  Admin and Liaison are more surface to guard.

---

## Per-firm deliverable statuses (planned 2026-09-04)

The deliverable pipeline — *Not started → Drafting → Under Review → Revising →
Finalizing → Pre-finalized → Awaiting Client → Outbox* — is one firm's internal
review culture, spelled out as string literals in a module constant. It is the
most likely thing the second firm asks to change, and the least configurable
thing in the app. This section is the plan; its first finding is that the
obvious version of the ask breaks the engine.

### What is actually there

**Postgres is on our side.** `deliverables.status` is plain `text` with **no
CHECK constraint** — unlike `matters`, `corporations`, `resolutions` and a dozen
others, nothing in the catalog pins this vocabulary. Every constraint on it is
application-level, which is what makes this tractable at all.

**Twelve values circulate; `STATUS_ORDER` names eight.** The four missing from
[lib/deliverable-status.ts](../lib/deliverable-status.ts) — `Filed or Sent out`,
`Archived`, `Submitted`, `Acknowledged` — are terminal or Internal-type states
that never appear as a board column. So `STATUS_ORDER` is *board layout*, not the
status set, and nothing in the repo names the actual set. That gap is the root of
the drift below.

**~390 literal occurrences across ~44 files.** The dense ones:
[lib/deliverable-actions.ts](../lib/deliverable-actions.ts) (the transition
graph, a `switch` on literals), [lib/admin/entity-config.ts](../lib/admin/entity-config.ts)
(the option list, hardcoded three times with three different subsets),
`components/FirmWorkloadCard.tsx`, [lib/queries/partner-analytics.ts](../lib/queries/partner-analytics.ts).

**The vocabulary has already drifted, in three places independently** — each of
which invented its own answer to "what counts as done":

- [lib/assistant/tools.ts](../lib/assistant/tools.ts) excludes
  `"Completed","Filed","Cancelled","Archived","Filed or Sent out"`. The first
  three do not exist and never did in this schema.
- [lib/portal/matter-insights.ts](../lib/portal/matter-insights.ts) —
  `DELIVERED_STATUSES = {'Filed', 'Filed or Sent out', 'Sent out'}`.
- [lib/portal/data.ts](../lib/portal/data.ts) — `FILED_STATUSES`, a second
  separate copy of that same set.

Three private guesses at the same predicate is the bug this work fixes before
per-firm labels enter it at all.

**Postgres does reason about the labels, in four places.**
`webhook_deliverable_finalized()` fires on `Pre-finalized → Outbox` (baseline,
re-declared in `20260823_trigger_payloads_firm_id.sql`);
`break_status_report_links_on_archive()` fires on `Archived`; `global_search()`
filters `deliverables.status <> 'Archived'` and again through the `filings` view.
`deliverable_status_history.new_status` stores the literal, so **history rows
carry old labels forever** — a rename silently splits every analytics milestone
computed from them.

**The collision hazard.** `'Archived'` is also a `matters.status` and a
`kb_pages.status`; `'Drafting'` is also a `corporations.esparc_status`. Those
live under real CHECK constraints and share nothing but the word. Three more
`'Archived'` sites in `touch_matter_activity()` and
`touch_matter_activity_via_channel()` are `matters`, not deliverables. A
repo-wide find-and-replace corrupts them.

### The design decision: semantic roles, configurable presentation

Letting a firm type arbitrary statuses breaks the engine. The code does not only
*display* status — it reasons about it in six distinct ways: forward
transitions, revert targets, terminal filtering, the finalize webhook, analytics
milestone bucketing, and portal "delivered" derivation. Free-form values leave
all six guessing.

So the engine knows a fixed set of **roles**, and a firm configures label,
colour, board order, and eventually which stages it uses:

```
not_started · drafting · review · revising · finalizing · pre_final
outbox · done · archived · awaiting_client
internal_submitted · internal_acknowledged
```

Twelve roles for the twelve values in circulation, so the mapping is 1:1 and the
conversion is a rename with no behaviour change.

**The corollary is the expensive part: `deliverables.status` must store the role
key, not the label.** Keep storing labels and a firm renaming "Pre-finalized"
either rewrites its own history or breaks every query naming it. Either way all
~390 literals get replaced — by a role constant or by a label lookup. Role keys
is the only version that survives a rename.

### Phase 0 — freeze the vocabulary. No behaviour change.

One module owns the twelve roles, the label map, and the semantic predicates
(`isTerminal`, `isDelivered`, `isActive`). Collapse the three drifted sets into
it and delete the phantom statuses. Add `verify:status-literal` to the chain — an
allowlist ratchet in the shape of [scripts/audit-person-shaped.ts](../scripts/audit-person-shaped.ts),
so a new bare literal fails until somebody routes it through the module, with the
pure rule in `lib/` and its negative controls in the unit suite.

Worth doing on its own merits even if the rest never happens: it fixes three live
inconsistencies and makes phase 1 mechanical rather than archaeological.

**DONE (2026-09-28).** [lib/deliverable-status.ts](../lib/deliverable-status.ts)
holds the twelve values, the two pipelines by type, and four roles — finalized,
delivered, closed, handed off — each with a predicate; CLAUDE.md → "Deliverable
statuses" is the editing rule. `verify:status-literal` is in the chain. What the
sweep found, beyond the three inconsistencies expected:

- **Six answers to "what counts as done", not three.** Open-work filters
  excluded filed-and-archived, or filed-acknowledged-archived, or those plus
  submitted. They now ask `CLOSED_STATUSES` (nothing left to do) or, for a
  lawyer's own queue, `HANDED_OFF_STATUSES`. The visible effect: acknowledged
  internal deliverables stop counting as open work on workload, calendar and
  partner views.
- **Phantom statuses in live filters** — `Completed`, `Filed`, `Cancelled`,
  `Done`, `Sent out`, `Filed or Sent Out` — in the deadline cron, the
  assistant's schedule, the portal's delivered count, corporate filing history,
  the compliance routes and the ad-hoc status report. The deadline cron's list
  was all phantoms plus Archived, so it reminded people about work already filed.
- **Pickers ignored the deliverable's type.** The detail-page status pill offered
  the external pipeline on internal deliverables; it now offers the type's own
  statuses (`pickableStatusesForType`).
- **The admin dropdowns had drifted too**, beyond the three status lists:
  matter status offered "Closed" (the CHECK allows Ongoing / Done / Archived, so
  choosing it failed — and billing setup filtered on it, offering finished
  matters); task status offered "Not Started" / "In Progress", casings nothing
  else writes; the hearing table coloured a "Completed" nothing sets; the
  liaison assignee list was one firm's three staff by name. Each now reads a
  shared constant or, for liaisons, the firm's own roster.

The rule is parsed, not grepped: it reads each item of a PostgREST in-list, so
the drifted `.not('status', 'in', '(…)')` filters — most of the sites — are
covered, and a status inside a comment or a longer string is not a hit.

### Phase 1 — role keys in the database

A migration converting `deliverables.status` and both `deliverable_status_history`
columns; the four SQL sites rewritten; the UI resolving labels at render.
Behaviour identical throughout.

**This is the risky phase, and it is the same shape as the PR 5 bulk swap** that
converted ~60 handlers and missed 8 write regressions. The gate goes in before
the sweep, not after — a sweep verified by reading the diff is how that one
passed review.

### Phase 2 — per-firm labels, colours, board order

A `deliverableStatusesSchema` exported from [lib/firm/config.ts](../lib/firm/config.ts)
into `firms.settings`, a `section: 'statuses'` arm on the existing
discriminated-union PATCH at `app/api/platform/firms/[id]/route.ts`, and an
editor on the firm detail page. The established rule applies unchanged: the route
validates through the loader's own schema, so nothing can be written that
`getFirmConfig` reads back as a default.

Client components need the map without prop-drilling through 40 files, so it
wants a `StatusProvider` mounted in the role layouts — same reasoning and same
shape as `FeatureProvider` and `BrandProvider`, and for the same reason: a shell
constructed per page is one a new page forgets.

### Phase 3 — stage skipping (deferred)

A firm with no separate pre-finalization step. This changes the transition graph
rather than its labels, so it is a different kind of change and should not ride
along with phase 2.

### Costs to price in before starting

- **Clients see these labels.** The portal derives "delivered" from status, so a
  firm's rename reaches its clients' screens, not just its staff's.
- **The guides state the status names** — five files under `docs/guides/`.
  Per-firm labels mean the guides teach the *shape*, the same rule
  `verify:brand` already imposes on firm names.
- **Analytics keys on the terminal states.** `partner-analytics.ts` buckets
  milestones on `Under Review` / `Finalizing` / `Filed or Sent out` and computes
  cycle time from them; history rows written before the conversion must map, or
  every pre-conversion deliverable falls out of the numbers.

### Recommendation

Phase 0 standalone, now — it is nearly risk-free and fixes real bugs. Decide
phases 1 and 2 against how near the second firm actually is; phase 0 alone keeps
the option open at no carrying cost.

## The Library and Search port from the origin app (2026-09-28)

The origin app's #157, #159, #209, #211, #213, #214 and #222 were ported and
adapted to tenancy: one Library table with version history and lawyer
authoring, exact-match Search with text recovery for scanned files, file
facets, and the Rules of Court per firm. The editing rules are in CLAUDE.md →
"The Library and Search". Left open:

- **Drop `resources_legacy_20260928`.** The merge renamed `resources` rather
  than dropping it; its 9 dev-firm rows are carried into `kb_pages`
  (`legacy_resource_id` maps each back). Drop it once nothing has needed it,
  with the usual checks (no code reference, no inbound FK, no view, no
  function).
- **Rule periods (origin app #254) not ported.** It lists every period the Rules
  of Court state on the Court Rules page, ready to become a rule set. The
  extraction is deterministic, but each period's label comes from a model
  call over public text — that needs its own reason in
  `anthropicForPlatform`'s closed union, or a per-firm call under a firm's
  consent. Decide which before porting.
- **The drafting commits that feed the Library were not ported** (origin app #220
  draft-vs-filed evaluation, #223 research citing the Rules, #239
  drafting-lessons pages). They sit on Drafting Studio work Lumilex does not
  have yet (#215–#218, #221, #238).
- **No history UI.** `/api/content-revisions` lists and restores, but no
  screen calls it — the same as upstream.
- **Search stays behind `ai_search`.** Its keyword half sends nothing to a
  model and would work for a firm without AI. Opening `/dashboard/search` to
  those firms is a product decision, not a port.
- **Guide PDFs and screenshots.** `docs/guides/images/common/login.png`
  shows the origin firm's name and mark, and the committed PDFs predate
  several removals (clock-in among them) and print their screenshots as
  broken images. Regenerating them would embed that screenshot, so recapture
  on a neutral firm first, then regenerate with the pipeline in
  `docs/guides/pdf/README.md`.

## Billing a sent trademark report (origin app #488) — deferred (2026-11-21)

The origin app files a draft off-cycle invoice when a trademark client report
is sent, for the managing partner to approve. It prices the step by matching
it to rows of the origin firm's own fee card by their wording and slug, with
the step-to-fee pairs (filing, Office Action response and extension,
issuance, the DAUs, renewal) and their per-class rules written in code.

Lumilex's fee schedules are per firm and seeded unpriced, so neither the card
nor the wording match exists here. Porting it properly needs:

- a per-firm setting mapping each billable trademark step to rows of that
  firm's own fee schedule, with the quantity rule (per class or once) and the
  official-fee row;
- an editor for that mapping, on the fee-schedule settings page or
  `/platform`;
- `trademarks.entity_size` and the Standard / Discounted pick at approval.

Off-cycle invoice requests (#362), which #488 files into, are already ported.
Until this lands, finance raises the invoice for a sent report by hand.
