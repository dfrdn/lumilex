# Lumilex — Admin Cheatsheet

Full guide: [Admin](../admin.md) · Basics: [common](common.md)

## Top tasks

| Task | Path → action |
|---|---|
| Fix any record | `/admin/<entity>` table → click cell → edit → Enter |
| Bulk import | entity table → **Import** → paste TSV / upload CSV → preview → run |
| Finalize a document | Finalize (`/admin/finalize`) → **Finalize** → review AI proofread → annexes → confirm (→ Outbox, signed PDF) |
| Manual finalize | same queue → **Manual** → upload finished files |
| Reject one (with a reason) | same queue → **Dismiss…** → *Already added manually* / *Doesn't apply* / *Details are wrong* |
| Take a decision back | same queue → **Undo** on the decided card (7 days) |
| Invite a portal user | client page → Portal users → **Invite** (magic-link email) |
| Resend / revoke portal access | Firm settings → **Portal Users** (`/admin/portal-users`) → row actions |
| Preview a client's portal | Dashboard → All Clients → **Portal previews** → pick client (read-only) |
| New team member | `/admin/users` (super_user) → **Add User** **then** **Set Password** (no sign-in until step 2) |
| Reset someone's password | `/admin/users` (super_user) → **Password** → **Set Password** |
| Store an e-signature | Signatures (`/admin/signatures`) → upload transparent PNG |
| Any setup page | **Firm settings** (`/admin/settings`) — lists, wording, rules, identity, accounts; also **More** |
| Edit dropdown values | Firm settings → Dropdown Options (`/admin/settings/enums`) |
| "Who changed this?" | Audit Log (`/admin/audit-log`) → filter entity/action/date |
| Assign an errand | Liaison Command (`/admin/liaison-command`) → **Assign Errand** |

## Delete semantics

Active deliverable → **Archive** (soft) · archived deliverable + every other entity → **hard delete, permanent, audit-logged**. Filings & status reports are views over deliverables — nothing separate to create.

## Happens on its own

File AI analysis (minutes) · SharePoint mirror on finalize/receipt · SLA rules checked 7:00 AM daily · calendar feeds pick up schedule edits when each subscriber's app checks · client/matter codes auto-assigned · client renames cascade to finance · 60-day matter auto-archive.

## ⚠️ Cannot undo

Hard **Delete** (any table, single or batch) · **Revoke** portal access · **Resend** invite (old link dies) · **Set Password** (immediate) · **Finalize** (version bump → Outbox) · **Delete** an errand (permanent; a completed one strands posted expenses — don't) · **Delete** a Library handbook page.

Proposal decisions are the exception — **Confirm & calendar** and **Dismiss…** both undo for 7 days from the queue.

## Looks wrong?

Finalize warns "missing signature" → upload it under Signatures · new member can't sign in → run Set Password · dropdown missing a value → add in Dropdown Options · completed errand needs undoing → finance reverses the money first, never delete.

_Last verified against commit `5856f3e` on 2026-08-11._
