# Lumilex — Lawyer & Partner Cheatsheet

Full guide: [Lawyers & Partners](../lawyer.md) · Basics: [common](common.md)

## Top tasks

| Task | Path → action |
|---|---|
| Log time | My DTR (`/dashboard/my-dtr`) → **Add DTR** → task, date, hours, remarks, matter, with |
| See what's on you | My Deliverables (`/dashboard/deliverables`) opens on **Mine** · views: All, Filings, Status reports, Internal, By status |
| Move a deliverable | deliverable card/page → workflow button (**For Review**, **For Revision**, …) → comment (+ attach = new version) → DTR prompt |
| Hand item to someone | deliverable page → **Currently With** → edit |
| Mark hearing/meeting attended | dashboard **Today's schedule**, or Calendar → **Hearings** / **Meetings** tab → **Attended** → confirm → pre-filled DTR |
| Mark a filing filed | **Today's schedule** filing row → **Mark as Filed** (status report often auto-creates) |
| AI first draft | Drafting Studio (`/dashboard/drafting`) → matter, ask, format, model → **Generate draft** |
| Check a judicial affidavit | Affidavit Review (`/dashboard/affidavit-review`) → Self-review / Opposing JA → **Review for objections** |
| Stress-test a pleading | Red Team (`/dashboard/red-team`) → Ours / Theirs → **link the matter** → **Red team this draft** |
| Check an Answer / Reply / Opposition | same, plus **Is this a response to another pleading?** → attach what it answers → **What we answered** panel flags allegations left undenied |
| Ask the client for documents | matter page → **Client file requests** → describe + due date |
| Status report to client | matter brief / filed deliverable → **Draft Status Report** |
| Matter catch-up | matter page → brief + **Exec Summary** (regenerate on demand) |
| Personal triage | My Matters → **Urgency** + **Notes** (private to you) · **Group** by Risk / Client / Urgency |
| Follow a dispute | Cases (`/dashboard/cases`) → **New case**, or a Litigation/Labor matter's **Case** card → **Start a case** → **File the case** |
| Record a TM or company filing | Trademarks / Corporations → **Needs action** → **Response filed**, **Filed**, … → the day it happened (today or earlier); a TM step's toast carries **Undo** |
| Report a step to the client | mark or company page → **Client report to send** → **Review & send** (unsigned; from the firm's trademark / compliance mailbox) |
| Trademark deadlines | `/dashboard/trademarks/deadlines` (computed — never typed) |
| Show a company or mark to the client | its page → **Client portal** switch → **What the client will see** → **Show to client** (team lawyer, relationship partner, partner or admin; needs a covering matter and an active portal user) |
| Write a firm guide or policy | Library (`/dashboard/library`) → **New page** → **Save draft** / **Publish** |

## Deliverable statuses

Not started → Drafting → Under Review → Revising ↺ → Finalizing → Pre-finalized → Outbox → **Filed or Sent out**. Park: Awaiting Client · Shelve: Archived · Internal only: Submitted → Acknowledged.

Buttons appear only when the item is **with you**. Forward moves need a **comment + time entry**.

## Partner-only

| Task | Path |
|---|---|
| Find partner pages | sidebar **Partner** group (counts = waiting on you); the rest under **More** → Partner |
| Approve pre-final work | `/dashboard/partner/pre-finalizing` |
| Billing bundles (MP approves, relationship partner clears) · off-cycle invoices (MP approves) | `/dashboard/partner/billing-review` |
| Leave / feedback decisions | `/dashboard/partner/leaves` · `/feedbacks` (**Dismiss** one that needs no reply; **Restore** undoes) |
| Collection rate vs operating costs | `/dashboard/partner/finance-overview` (filter period/client; click a bar for the month) |
| Client & matter oversight | `/dashboard/partner/clients` · `/matters` · matter page status pill · My Matters → **My clients** (relationship partner) |
| Intake kanban | `/dashboard/prospects` (Lead → … → Engaged/Declined) |
| Engagement proposals | `/dashboard/prospects/proposals` (all versions; **New proposal** → prospect or existing client) |
| Reusable scope text | `/dashboard/prospects/scope-library` (carve-outs always print last) |
| Review Library drafts | `/dashboard/library` → **Needs review** · **Build from matters** |

## Happens on its own

Brief/health refresh (overnight / within ~6h) · file AI analysis (minutes), then scanned text read for exact-match search · filed → status-report proposal (not for a mark's filings) · 60-day idle auto-archive (+auto-reactivate) · TM deadlines computed · company/mark status in the lists catches up every 5 min · SEC registration raises year-1 GIS/AFS/ITR deliverables, and every night (~3:00 AM) the next period's — only the filings ticked under **Filings we handle** (no BIR 0605 — fee abolished by RA 11976; GIS date is a placeholder off fiscal year end unless Meeting Month/Day are set) · business permit is a **task** (initial / confirm and record / renewal) · a mark's step and its deliverable record each other · **Extension denied** puts a TM deadline back to the original period · a hearing set on a matter files itself under its one open proceeding · DTR prompts after attend/file/handoffs · Drafting Studio outputs unattached to a matter deleted after 30 days.

## ⚠️ Cannot undo

Clear a billing bundle for billing (generates the invoice) · MP **Clear without their sign-off** (bills over the relationship partner; reason required, they're notified) · Archive mid-review (clears everyone's queue — use **Awaiting Client**) · **Mark as Filed/Sent Out** · delete submission/comment/DTR entry · approve/reject leave · delete prospect · delete a Library handbook page (partners/admin) · mark a proposal sent · send a client report · delete a company (type its name) · remove a proceeding · revoke portal access · resend portal invite (old link dies).

## Looks wrong?

No workflow buttons → item isn't with you (check Currently With) · page missing from the sidebar → **More** or ⌘K; Filings / Status reports / Internal are My Deliverables views, Hearings / Meetings are Calendar tabs · can't edit a My DTR entry → a colleague logged it with you; only they can · matter gone from Ongoing → auto-archived, any work restores · brief stale → "· stale" flag, refreshes overnight · "not found in juris.ph" → verify the citation (SC decisions + RAs only; CA and lower courts aren't indexed) · Red Team amber banner → juris.ph was unreachable, so nothing was verified — rerun later.

_Last verified against commit `71f68cd3` on 2026-08-18._
