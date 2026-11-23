-- Platform operators — the third identity kind.
--
-- `team` is a firm's staff and `client_users` is a firm's clients. Both are
-- tenant rows, both are firm-scoped by construction, and neither can see past
-- its own firm. A platform operator is neither of those: it is the identity
-- behind /platform, the one surface that is deliberately cross-tenant.
--
-- Keyed on auth.users so it shares the single sign-in everyone else uses, and
-- carrying no firm_id at all. Rejected alternatives, for the record: a flag on
-- `team` (a firm-scoped row granting cross-firm power is exactly the coupling
-- the multi-tenant conversion removed — one bad UPDATE on a tenant table would
-- become platform-wide escalation) and an env allowlist (no audit trail, and a
-- redeploy to change).
--
-- RLS enabled with NO policies: deny-by-default, service-role only, like the
-- other 27 such tables. Nothing reads it through PostgREST; lib/platform/auth.ts
-- resolves it server-side and is the only reader.
create table if not exists public.platform_operators (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email        citext not null unique,
  name         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.platform_operators enable row level security;

comment on table public.platform_operators is
  'Cross-tenant platform operators (/platform). Global table (no firm_id). Deny-by-default RLS: service-role only.';

-- audit_log gains a third actor kind, for the same reason logAgentAudit exists
-- alongside logAudit: an operator action recorded as a firm staff member''s
-- would attribute a cross-tenant change to a person who cannot make one.
-- `audit_log_human_has_actor` already requires performed_by for anything that
-- is not an agent, and an operator row carries its auth_user_id there.
alter table public.audit_log drop constraint if exists audit_log_actor_type_check;
alter table public.audit_log add constraint audit_log_actor_type_check
  check (actor_type = any (array['human'::text, 'agent'::text, 'operator'::text]));
