# Lumilex — Finance Cheatsheet

Full guide: [Finance](../finance.md) · Basics: [common](common.md)

## The monthly loop

| Task | Path → action |
|---|---|
| Curate a bundle | Review & Generate (`/finance/dtr-review`) → month → client → edit / exclude / waive entries & expenses |
| Add one-off charge | bundle → **Additional Items** → **+ Add item** |
| Per-invoice overrides | bundle → **Invoice settings** (recipient, discounts, previous balance, emails) |
| Submit for approval | bundle → **Submit for review** (MP approves, then the client's relationship partner clears; clearance auto-generates the draft invoice) |
| Send invoices | Invoices (`/finance/invoices`) → **Send Invoices** → upload signed PDFs → check the billing email → send from the firm's billing address |
| Bill a fee between monthly runs | Invoices → **Off-cycle invoice** → client → tick fees / add items → **Billing statement for** → **Send for approval** (MP approves in Billing Review; approval generates the draft) |
| Record a payment | Receivables (`/finance/receivables`) → invoice → **Record payment** (method Deposit draws from trust) |
| On-account cheque | client row → **Record a payment toward the running balance** (allocates oldest-first) |
| Deposit / refund / adjustment | client row → **Record an advance deposit, refund, or adjustment** (moves trust bucket only) |
| Post-send discount | invoice → **Record a post-send discount / credit** (reverse it from the same dialog) |
| Chase late invoices | Receivables → **Follow-ups** (template auto-picks: reminder ≤30d, overdue 31–60d, final >60d) |
| Pay staff back | Reimbursements → select → **Mark Reimbursed** (independent of client billing) |
| New matter opened | Finance settings → Billing Configs → configure its billing type (unconfigured can't bill) |
| Who the letter goes to, VAT, early-payment discount | Billing Configs → **By client** → the client's billing profile |
| Reword the billing letter or email | **Finance settings** → Billing letter (`/finance/billing-letter`) → paragraph → **Shows when** |
| Cash flow / profitability | **Insights** (`/finance/insights`) → **Leakage** · **Cash flow** · **Profitability** tabs |

## Statuses & semantics

| Invoice | draft → sent → partial → paid (partial/paid derive from payments; lateness = due date) |
|---|---|
| **Edit** | appears as edited, billed |
| **Exclude** | vanishes from the invoice |
| **Waive** | printed struck-through, billed ₱0, doesn't eat the retainer cap |

Money buckets: **receivables** (amount due — only payments move it) ≠ **deposit on hand** (trust — deposits/refunds/applications). Bills settle from any advance deposit **by default** (deduction printed on the bill, deposit drawn down on send) — opt out per matter when the deposit is earmarked. VAT 12% on top; analytics stay pre-VAT.

## Happens on its own

Draft generation on relationship-partner clearance (off-cycle: on MP approval) · early-payment discount booked as a credit when payments by the pay-by date reach the discounted amount (undone with the payment) · sent-date stamp + billed flags on send · deposit auto-applied on send for settle-from-deposit matters (blocked if the deposit no longer covers the printed figure — regenerate) · partial/paid from payments · balances by trigger · recurring operating expenses (1:00 AM) · bundle resets to pending if edited post-approval (non-MP) · errand completions post transport expenses.

## ⚠️ Cannot undo

**Send** (invoice or follow-up email) · **Delete draft** (monthly or off-cycle; files gone, number never reused) · on-account receipt reverses only **as a whole**.

## Looks wrong?

Client in "Inactive" bucket / "No email for client" → name string or contact email mismatch on the client record · "Generate the invoice first" → no letter PDF yet · "Firm invoice settings are incomplete" → a field on Finance settings → Firm Invoice Details is blank or still `PLACEHOLDER — …`; the message names which · "Firm branding is incomplete" → a brand setting (colours, name, document name) isn't set; the message names it — ask whoever manages the firm's configuration · approved bundle pending again → someone edited it; re-review · partner dashboard ≠ your numbers → theirs is sent-only, pre-VAT · credit undo fails from the row → use the credit dialog.

_Last verified against commit `e072d1d5` on 2026-08-12._
