# Lumilex — Everyone's Cheatsheet

Full guide: [The Basics](../common.md) · All times Manila, all amounts ₱

## Daily basics

| Task | Path → action |
|---|---|
| Sign in | `/login` → email + password (forgot? ask a partner/admin — no self-serve reset) |
| Check what's due | `/dashboard` → **Needs attention**, **Up next**, **Today's schedule**, **My deliverables** |
| Find any page | sidebar → **More** (search, every page you can open) · **Customize** to pin / hide / reset links |
| File leave / reimbursement / feedback | `/dashboard` → **Requests** menu → track in **My Requests** |
| Search (jump to a thing) | **⌘K** → navigate mode |
| Search (find a document) | **⌘K** → Search mode, or Search (`/dashboard/search`) — **Exact** matches first; quote a phrase |
| Firm guides, policies, codes, Rules of Court | Library (`/dashboard/library`) |
| PH case law | Search → **Jurisprudence** tab (juris.ph — verify before citing) |
| Change password / photo / nickname | your picture (top right) → **My Settings** → **Security** / **Profile** tab |
| Enable push | Settings → **Notifications** → **Browser push notifications** (off by default) → **Send test push** |
| Mute a noisy matter | bell → hover group → bell-off icon; unmute in Settings → **Notifications** → **Muted items** |
| See what a client sees | All Clients → **Portal previews** (partner/admin) → opens read-only client portal |

## Notifications

| Tier | What | Where |
|---|---|---|
| Action | assignments, deadlines, mentions, hearings | **For you** tab — counts in the red badge |
| FYI | status changes, client uploads | **FYI** tab — silent |

## Happens on its own

| When | What |
|---|---|
| minutes after upload | AI file summary appears; document becomes searchable (scans too — their text is read) |
| 5:45 AM | deadline reminders (due today/tomorrow, open work only) hit the bell |
| 7:00 AM | SLA rules checked; breaches show in My Matters' SLA box |
| 6:00 AM Mon–Fri | briefer email (skipped if you have nothing on) |
| overnight / 6-hourly | matter briefs / health scores refresh |
| daily 10:00 AM | matters idle 60 days auto-archive (any work reactivates) |
| minutes after finalize/receipt | SharePoint mirror copies (best-effort) |
| when your calendar app checks (usually hours) | schedule changes reach your subscribed calendar feed |

## ⚠️ Cannot undo

- **Mark all read** on the bell · **muting deletes** that entity's existing notifications
- Revoking a client's portal access (account deleted) · resending an invite kills the old link

## Looks wrong?

- File shows **Needs re-upload** → pre-migration relic; upload the original again
- Citation "not found in juris.ph" → check the citation; if all show unchecked, the service is down
- Dashboard number lags an edit → ~30 s snapshot; navigate and it catches up · a widget says "Couldn't load" → reload
- A page isn't in the sidebar → **More**, or type its name in ⌘K search
- SharePoint copy missing → best-effort mirror; the in-app file is authoritative

_Last verified against commit `e3ebe1c` on 2026-07-21._
