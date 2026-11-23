-- Drop the quarterly evaluation and bonus-deliberation surface.
--
-- It encoded one firm's compensation politics: a fixed rubric, partner profit
-- shares, an associate bonus pool, discretionary and "other" bonuses, and a
-- managing-partner-gated deliberation lock. No two firms share a bonus model,
-- so this was never going to transfer to a tenant — and `lib/evaluations/
-- partner-shares.ts` shipped one real firm's partner percentages keyed by their
-- initials, which `verify:brand` cannot see (it greps for the firm name).
--
-- Verified before writing this, against the live catalog:
--   * all five tables empty;
--   * no foreign keys into them from outside the set (only `firms`, and their
--     own parent/child links);
--   * no view and no function names any of them.
--
-- Dropped children-first so plain DROP suffices — no CASCADE, which would
-- silently take a dependant with it if one ever appeared:
--   evaluation_scores            -> evaluations
--   evaluations                  -> evaluation_periods
--   evaluation_period_*_bonuses  -> evaluation_periods
--
-- Two finance surfaces read `evaluation_periods` and were changed rather than
-- broken. `/api/finance/firm-summary` took an optional ?periodId to resolve a
-- date window; its only caller was the deliberation view, so the branch is gone
-- and the route keeps its from/to form. `/api/finance/cash-flow` folded
-- `bonus_pool_php` in as a money-out line; with no way left to set a pool that
-- input was permanently empty, so it is removed. A firm that pays bonuses
-- records them as a `firm_expenses` row, which cash-flow already sums — and
-- BONUS_CATEGORY still colours that category distinctly in the dashboard.

DROP TABLE IF EXISTS public.evaluation_scores;
DROP TABLE IF EXISTS public.evaluation_period_other_bonuses;
DROP TABLE IF EXISTS public.evaluation_period_discretionary_bonuses;
DROP TABLE IF EXISTS public.evaluations;
DROP TABLE IF EXISTS public.evaluation_periods;
