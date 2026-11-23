---
name: update-guides
description: >
  Sync docs/guides/ (user guides, cheatsheets, decks, screenshots) with a code
  diff. Use after shipping or merging any user-facing change — a new route or
  screen, a changed workflow or status transition, a renamed field, a changed
  role gate, a new automatic behavior, or a new irreversible action. Also use
  when asked to "update the guides", "sync the docs with this change", or when
  a PR touches app/ without touching docs/guides/.
---

# Update the user guides from a diff

The comprehensive guides in `docs/guides/` are the single source of truth for how Lumilex behaves; `cheatsheets/` and `decks/` are derived from them, and `capture/manifest.md` maps screenshots to screens. This skill keeps all three tiers and the images in sync with a code change. Read the **User guides** section of `CLAUDE.md` first — it defines the contract this skill enforces.

## 1. Determine the diff

Default scope: uncommitted changes **plus** everything since the guides were last verified.

```bash
SHA=$(grep -ho 'commit `[a-f0-9]*`' docs/guides/README.md | grep -o '[a-f0-9]\{7,\}')
git diff --stat ${SHA}..HEAD -- app/ components/ lib/ proxy.ts
git status --short
```

If the user supplied a range, PR, or branch, use that instead.

## 2. Classify each change

Per CLAUDE.md's User guides section:

- **User-facing** → document: new route/screen, changed workflow or status transition, new/renamed user-filled field, changed permission or role gate, new automatic/background behavior, new irreversible action.
- **Not user-facing** → skip: refactors, type changes, internal helper moves, test-only changes, performance work with no behavior change.

For each user-facing change, read the changed page/component enough to describe the behavior in user terms — never document from the diff alone.

## 3. Map changes to roles

Cross-reference each touched route against the role gating in `proxy.ts` (the authoritative route-level map) plus any in-page role conditionals in the changed components:

| Route prefix | Guide |
|---|---|
| `/dashboard/partner/*`, prospects, evaluations | lawyer.md (Partner only sections) |
| `/dashboard/*` (rest) | lawyer.md, and common.md if the surface is cross-role (notifications, chat, files, search, settings, portal) |
| `/finance/*` | finance.md |
| `/admin/*` | admin.md |
| `/liaison/*`, errand APIs, transportation zones | liaison.md (zones/tariff also finance.md) |
| `/portal/*`, `/client-portal-preview/*` | common.md (client portal section) |
| crons, `lib/ai/*`, notifications, integrations | common.md's "What happens on its own" + the owning role guide |

## 4. Update the guides first

Edit the affected comprehensive guide sections. Keep the house style: task-oriented, second person, exact in-app labels with route paths like "Billing Review (`/finance/dtr-review`)", `> **Verify:**` callouts for anything you could not confirm in code, ⚠️ on irreversible actions, explicit cadence on automatic behavior. Never document a feature you cannot find in the code.

## 5. Propagate to cheatsheets and decks

Cascade a guide edit to that role's cheatsheet and deck **only** when it touches a top task, a status enum, an irreversible action, or an automatic behavior. Constraints that must survive your edits:

- Cheatsheet: one A4 page, tables and short lists, no images — cut content before growing the page.
- Deck: max ~40 words of body per slide, bold takeaway first, detail goes in the `<!-- notes: ... -->` speaker notes, 20–30 slides per role deck.
- Neither may state anything the guide doesn't. Same wording for paths, labels, and status values — not paraphrase.

## 6. Recapture affected screenshots

If a changed screen appears in `docs/guides/capture/manifest.md`, recapture per the manifest's procedure: dev server on port 3000, sign in via `/api/dev/team-signin?email=<manifest role>`, seed the term list (regenerate via `capture/terms.sql` + dictionary stop-word post-processing — never committed), inject `capture/anonymize.js`, loop `__ANON_SWEEP__()`/`__ANON_CHECK__()` until clean twice, 1440×900 light mode, re-apply any `capture/annotate.js` callouts the manifest lists. **Never save a shot while the check is non-empty; visually review each image; production data — read-only navigation only.** Update the manifest if a route/setup changed.

## 7. Reconcile and stamp

Over the touched roles only:

1. Every path, label, status name, and role restriction matches the guide exactly across tiers.
2. Every irreversible action in the guide appears in the cheatsheet's ⚠️ section and on the deck's cannot-undo slide.
3. Every automatic behavior appears in the cheatsheet's happens-on-its-own section (or common's master table).
4. Every referenced image exists; no orphan images (script this — check both directions).
5. Update the footer on every file you touched:
   `_Last verified against commit `<current short sha>` on <YYYY-MM-DD>._`
6. Regenerate the PDF render of every Markdown file you touched — procedure in `docs/guides/pdf/README.md`. A stale PDF contradicting its source is worse than no PDF.

## 8. Report

State: which changes you classified user-facing (and where you documented them), which you deliberately left undocumented and why, which screenshots you recaptured or flagged as stale, and anything ambiguous that needs a human decision (leave a `> **Verify:**` callout in the guide for these).
