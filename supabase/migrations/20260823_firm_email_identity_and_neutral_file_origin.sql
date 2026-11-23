-- Phase 6 wave B: the web and email identity becomes per-firm.
--
-- 1. `firms.settings.email` is now the only source of a firm's outbound sending
--    identity (lib/email.ts, the finance batch/follow-up senders, the trademark
--    report sender) and of the domain list that classifies every synced message
--    inbound or outbound (lib/firm-domains.ts). Seed the dev tenant so a fresh
--    checkout has a working, firm-neutral configuration.
-- 2. `firms.branding.logoLightPath` is the reversed-out wordmark the dark app
--    header needs. Declare the slot on every firm so the setting is discoverable.
-- 3. The `files.origin` dropdown carried the origin firm's name as the "came
--    from us" value. Renamed to 'Firm', which is what it always meant.

-- ── 1. Dev tenant email identity ─────────────────────────────────────────────
update public.firms
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'email', jsonb_build_object(
    'fromName',       'Lumilex Dev Firm',
    'fromAddress',    'notifications@dev.lumilex.app',
    'financeAddress', 'finance@dev.lumilex.app',
    'ipAddress',      'ip@dev.lumilex.app',
    'ownedDomains',   jsonb_build_array('dev.lumilex.app')
  )
)
where slug = 'dev'
  and coalesce(settings -> 'email' ->> 'fromAddress', '') = '';

-- ── 2. Declare the reversed-out wordmark slot ────────────────────────────────
update public.firms
set branding = coalesce(branding, '{}'::jsonb) || jsonb_build_object('logoLightPath', '')
where not jsonb_exists(coalesce(branding, '{}'::jsonb), 'logoLightPath');

-- ── 3. File origin ──────────────────────────────────────────────────────────
-- Applied once, on the instance that held the origin firm's rows: its
-- `files.origin` options and rows that named the firm were renamed to 'Firm'.
-- A fresh database never had such a value, so the step is not repeated here.
