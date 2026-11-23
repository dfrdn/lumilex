-- Drop what two feature deletions left in firm_integrations and firms.settings.
--
-- `email_autopilot` went with the court-mail autopilot and the email inbox;
-- `graph_mail` went with the Graph sendMail path when client-facing mail moved
-- to Resend. Both keys are out of FEATURE_KEYS, so these rows named features
-- that no longer exist: resolveFeature() could never return them and the
-- /platform Features panel had no spec to render them against. Same rule and
-- same shape as the DELETE in 20260829_drop_telegram_attendance_calendar_sync.sql.
--
-- Verified against the live catalog before writing: two rows, both the dev
-- firm's, neither holding a credential. The dev firm's Graph app registration
-- is not lost with `graph_mail` — its `sharepoint` and `docx_pdf` rows carry
-- the same `usePlatformEnv: true`, and getGraphConfigForFirm consults those.
--
-- The entitlement half is cleaned too. 20260823_firm_integrations.sql seeded
-- firms.settings.features with every key of the day, and the 2026-08-29 drop
-- removed the rows but not the flags — so `telegram`, `graph_calendar`,
-- `graph_mail` and `email_autopilot` were still `true` in the dev firm's
-- settings. Inert (isFeatureEnabled only ever asks about a FeatureKey), but a
-- flag saying a firm is entitled to a feature that does not exist is something
-- the next reader has to disprove.

DELETE FROM public.firm_integrations WHERE feature IN ('email_autopilot', 'graph_mail');

UPDATE public.firms
SET settings = jsonb_set(
  settings,
  '{features}',
  (settings -> 'features') - array['telegram', 'graph_calendar', 'graph_mail', 'email_autopilot']
)
WHERE settings -> 'features' ?| array['telegram', 'graph_calendar', 'graph_mail', 'email_autopilot'];
