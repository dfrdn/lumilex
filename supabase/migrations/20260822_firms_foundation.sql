-- Tenant foundation: firms registry, host mapping, and the re-key of
-- firm_invoice_settings from a hard singleton to a per-firm row.
-- RLS is enabled deny-by-default on the new tables; the authenticated
-- self-select policy arrives with current_firm_id() in the RLS-rework
-- phase. Until then all reads go through the service-role config loader.

create table if not exists public.firms (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name        text not null,
  short_name  text not null,
  status      text not null default 'active' check (status in ('active','suspended')),
  branding    jsonb not null default '{}'::jsonb,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.firms enable row level security;

create table if not exists public.firm_domains (
  domain     text primary key check (domain = lower(domain)),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  is_primary boolean not null default false
);
create unique index if not exists firm_domains_one_primary
  on public.firm_domains (firm_id) where is_primary;
alter table public.firm_domains enable row level security;

-- Development firm #1. Fixed UUID so code and fixtures can reference it
-- deterministically until sessions carry firm_id; the origin production
-- import creates its own firms row.
insert into public.firms (id, slug, name, short_name)
values ('00000000-0000-4000-8000-000000000001', 'dev', 'Lumilex Dev Firm', 'DEV')
on conflict (id) do nothing;

-- firm_invoice_settings: singleton (id=1 CHECK) -> per-firm row keyed by
-- firm_id, gaining the invoice numbering prefix. The baseline ships this
-- table empty (the origin firm's seed row was scrubbed), so no data migration.
alter table public.firm_invoice_settings drop constraint if exists firm_invoice_settings_singleton;
alter table public.firm_invoice_settings drop constraint if exists firm_invoice_settings_pkey;
alter table public.firm_invoice_settings drop column if exists id;
alter table public.firm_invoice_settings add column if not exists firm_id uuid;
alter table public.firm_invoice_settings add column if not exists invoice_prefix text;
update public.firm_invoice_settings set firm_id = '00000000-0000-4000-8000-000000000001' where firm_id is null;
alter table public.firm_invoice_settings alter column firm_id set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'firm_invoice_settings_pkey') then
    alter table public.firm_invoice_settings add constraint firm_invoice_settings_pkey primary key (firm_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'firm_invoice_settings_firm_id_fkey') then
    alter table public.firm_invoice_settings
      add constraint firm_invoice_settings_firm_id_fkey foreign key (firm_id) references public.firms(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'firm_invoice_settings_prefix_shape') then
    alter table public.firm_invoice_settings
      add constraint firm_invoice_settings_prefix_shape check (invoice_prefix ~ '^[A-Z0-9]{2,8}$');
  end if;
end $$;
