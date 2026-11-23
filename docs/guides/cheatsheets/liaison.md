# Lumilex — Liaison Cheatsheet

Full guide: [Liaison Officers](../liaison.md) · Basics: [common](common.md)

## Officer tasks

| Task | Path → action |
|---|---|
| See today's errands | My Errands (`/liaison/my-errands`) → Today / Overdue / All |
| Start an errand | errand row → **Mark in progress** |
| Finish an errand | errand row → **Complete** → confirm amount (explain if ≠ tariff) → note → **Mark Completed** |
| Log working time | My DTR (`/liaison/my-dtr`) → **Add DTR** |
| File a non-errand expense | My Requests → **File Reimbursement** (category, amount, receipts) |
| Track your money/leave | My Requests (`/liaison/my-requests`) → Leaves / Reimbursements / Feedbacks |
| Plan around hearings | Firm Calendar (`/liaison/calendar`) |
| Settings, sign out | sidebar **Settings** (`/liaison/settings`), or your picture (top right) |

## Chief tasks (chief_liaison_officer; admins mirror at `/admin/liaison-command`)

| Task | Path → action |
|---|---|
| Assign an errand | Command Center (`/liaison`) → **Assign Errand** → title, officer, priority, zone, schedule, client+matter, deliverable |
| Rebalance load | table → inline **reassign** (click assignee) / **reschedule** (click date) |
| Fix an errand | table → **Edit** |
| Who is going where | Liaison Schedule (`/liaison/schedule`) |

## Errand statuses

pending → in progress → **completed** (via Complete flow only — terminal) · cancelled (chief).
Due date = linked deliverable's deadline, automatic. No deliverable = no due date.

## What Complete posts (one click, two ledgers)

1. Your **Transportation reimbursement** (internal zone rate — appears in My Requests by itself; don't file it again).
2. The **client's expense** (external rate, or internal if no-markup, or nothing if unbillable) → client's next invoice.

## Happens on its own

Reimbursement row auto-created on completion · errand due dates inherited · expense dated on completion day (lands in the open billing month) · your schedule visible firm-wide (Liaison Schedule).

## ⚠️ Cannot undo

**Mark Completed** (money posts; finance must reverse — never ask for a delete) · chief **Delete** errand (permanent) · deleting your reimbursement filing (pending only).

## Looks wrong?

Amount ≠ what you spent → change it at completion + write the override note · zone missing / rate stale → finance owns the Transportation Tariff · wrong details after completing → tell chief + finance; don't delete · can't edit your errand → only the chief can; message them.

_Last verified against commit `e3ebe1c` on 2026-07-21._
