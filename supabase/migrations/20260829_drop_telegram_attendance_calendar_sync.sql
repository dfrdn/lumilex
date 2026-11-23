-- Drop what three feature deletions left behind.
--
-- The calendar push (replaced by the subscribable feed) and, in this change,
-- the Telegram assistant and the staff clock-in gate were all removed from the
-- code. Each left its tables and columns standing on the "inert, not live"
-- rule, so nothing read them and nothing broke. This is the migration that
-- finally clears them.
--
-- Verified before writing this, against the live catalog:
--   * zero code references outside lib/tenancy/tables.generated.ts (regenerated
--     after this runs) — the remaining `attendance` matches in app/ are the
--     corporate meeting attendance SHEET, an unrelated slot on `meetings`;
--   * no inbound foreign keys, no views, no functions naming any of them;
--   * telegram_link_codes, telegram_messages and calendar_sync_events empty;
--     attendance held one dev-firm row ("Dev Admin"), no client data;
--   * team.telegram_user_id set on 0 rows, team.calendar_sync_enabled true on 0.
--
-- Deliberately NOT written as DROP ... CASCADE. There are no dependants today,
-- so a plain DROP is equivalent — and if that ever stops being true, this
-- should fail loudly rather than quietly take a dependant with it.
--
-- The `attendance` trigger (attendance_set_last_edited_trg) drops with its
-- table; no separate statement is needed.

DROP TABLE IF EXISTS public.telegram_link_codes;
DROP TABLE IF EXISTS public.telegram_messages;
DROP TABLE IF EXISTS public.attendance;
DROP TABLE IF EXISTS public.calendar_sync_events;

ALTER TABLE public.team DROP COLUMN IF EXISTS telegram_user_id;
ALTER TABLE public.team DROP COLUMN IF EXISTS calendar_sync_enabled;

-- Both keys are out of FEATURE_KEYS, so these rows named features that no
-- longer exist: resolveFeature() could never return them and the /platform
-- Features panel had no spec to render them against.
DELETE FROM public.firm_integrations WHERE feature IN ('telegram', 'graph_calendar');
