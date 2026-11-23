-- Per-firm feature switches and bring-your-own integration credentials.
--
-- One row per (firm, feature). A missing row is the OFF position: the guard in
-- lib/firm/features.ts reads absence as disabled, never as unrestricted — the
-- same rule lib/agents/registry.ts applies to an unregistered agent id. Adding
-- a feature key means adding a row, not relaxing a default.
--
-- `config` holds the non-secret half of an integration (directory tenant id,
-- application id, drive user, SharePoint site) so an operator can read it back
-- and an admin surface can render it. None of it is usable without the other
-- half. `credentials_enc` holds that other half: a single AES-256-GCM blob over
-- a JSON object of secrets, sealed with the platform key INTEGRATION_CREDS_KEY
-- (lib/firm/secrets.ts). Postgres only ever sees ciphertext, so a database dump
-- or a stray SELECT is not a credential leak.
--
-- RLS: enabled with no policies — deny-by-default, service-role only. Flags are
-- resolved server-side through getServiceDbForFirm(); no browser session selects
-- from this table, and `credentials_enc` must never reach one.

create table if not exists public.firm_integrations (
  firm_id         uuid not null references public.firms(id) on delete cascade,
  feature         text not null,
  enabled         boolean not null default false,
  config          jsonb not null default '{}'::jsonb,
  credentials_enc text,
  updated_at      timestamptz not null default now(),
  primary key (firm_id, feature)
);

alter table public.firm_integrations enable row level security;

drop trigger if exists firm_integrations_touch on public.firm_integrations;
create trigger firm_integrations_touch
  before update on public.firm_integrations
  for each row execute function public.touch_updated_at();

-- ── Dev firm seed ────────────────────────────────────────────────────
--
-- Every feature on, so development keeps behaving exactly as it did before the
-- guards existed. The four Microsoft Graph features and Telegram additionally
-- carry `usePlatformEnv: true`.
--
-- That flag is an explicit declaration, not a fallback. A Graph app registration
-- lives in ONE Entra directory: its app-only token can only reach that
-- directory's mailboxes, calendars, drive and SharePoint site. Handing the
-- platform's credentials to a second law firm would not merely fail — for
-- SharePoint and OneDrive it would SUCCEED, filing that firm's client documents
-- into the first firm's document library, outside anything RLS can see. So the
-- code never falls back. The dev firm gets the flag because the platform env
-- genuinely IS its own tenant's app; a firm onboarded later supplies its own
-- credentials or the feature stays unconfigured.

insert into public.firm_integrations (firm_id, feature, enabled, config)
select
  f.id,
  v.feature,
  true,
  v.config
from public.firms f
cross join (values
  ('portal',          '{}'::jsonb),
  ('graph_mail',      '{"usePlatformEnv": true}'::jsonb),
  ('graph_calendar',  '{"usePlatformEnv": true}'::jsonb),
  ('sharepoint',      '{"usePlatformEnv": true}'::jsonb),
  ('docx_pdf',        '{"usePlatformEnv": true}'::jsonb),
  ('telegram',        '{"usePlatformEnv": true}'::jsonb),
  ('push',            '{}'::jsonb),
  ('issuances',       '{}'::jsonb),
  ('drafting',        '{}'::jsonb),
  ('red_team',        '{}'::jsonb),
  ('email_autopilot', '{}'::jsonb)
) as v(feature, config)
where f.slug = 'dev'
on conflict (firm_id, feature) do nothing;

-- The entitlement half of the guard: firms.settings.features. A feature is
-- available only when the firm is entitled to it AND its integration row is
-- enabled AND (for a bring-your-own integration) its credentials are present.
-- Both halves fail closed on their own.
update public.firms
set settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{features}',
  jsonb_build_object(
    'portal',          true,
    'graph_mail',      true,
    'graph_calendar',  true,
    'sharepoint',      true,
    'docx_pdf',        true,
    'telegram',        true,
    'push',            true,
    'issuances',       true,
    'drafting',        true,
    'red_team',        true,
    'email_autopilot', true
  ),
  true
)
where slug = 'dev'
  and coalesce(settings, '{}'::jsonb) -> 'features' is null;
