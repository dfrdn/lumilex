-- Multitenancy phase 2, wave 2: re-key global uniques to (firm_id, ...) composites.
-- Old constraint/index names verified against pg_constraint / pg_indexes on the
-- Lumilex dev project 2026-08-22. Uniques that were bare indexes are dropped with
-- DROP INDEX; uniques that were table constraints are dropped with DROP CONSTRAINT.

-- clients ---------------------------------------------------------------------
-- clients_client_code_unique and clients_name_unique_ci are bare unique indexes.
drop index if exists public.clients_client_code_unique;
create unique index if not exists clients_firm_client_code_unique
  on public.clients (firm_id, client_code);

-- Original: CREATE UNIQUE INDEX clients_name_unique_ci ON public.clients (lower(normalize_client_name(name)))
drop index if exists public.clients_name_unique_ci;
create unique index if not exists clients_firm_name_unique_ci
  on public.clients (firm_id, lower(public.normalize_client_name(name)));

-- invoices --------------------------------------------------------------------
alter table public.invoices drop constraint if exists invoices_invoice_number_key;
create unique index if not exists invoices_firm_invoice_number_key
  on public.invoices (firm_id, invoice_number);

-- dtr_revision_reviews --------------------------------------------------------
alter table public.dtr_revision_reviews
  drop constraint if exists dtr_revision_reviews_billing_month_client_name_key;
create unique index if not exists dtr_revision_reviews_firm_month_client_key
  on public.dtr_revision_reviews (firm_id, billing_month, client_name);

-- fee_schedules / scope_templates / resources (slug) --------------------------
-- fee_schedules_slug_key and scope_templates_slug_key are bare unique indexes;
-- resources_slug_key is a table constraint.
drop index if exists public.fee_schedules_slug_key;
create unique index if not exists fee_schedules_firm_slug_key
  on public.fee_schedules (firm_id, slug);

drop index if exists public.scope_templates_slug_key;
create unique index if not exists scope_templates_firm_slug_key
  on public.scope_templates (firm_id, slug);

alter table public.resources drop constraint if exists resources_slug_key;
create unique index if not exists resources_firm_slug_key
  on public.resources (firm_id, slug);

-- drafting_style_profiles -----------------------------------------------------
alter table public.drafting_style_profiles
  drop constraint if exists drafting_style_profiles_doc_type_key_key;
create unique index if not exists drafting_style_profiles_firm_doc_type_key
  on public.drafting_style_profiles (firm_id, doc_type_key);

-- billing_rates ---------------------------------------------------------------
alter table public.billing_rates drop constraint if exists billing_rates_position_key;
create unique index if not exists billing_rates_firm_position_key
  on public.billing_rates (firm_id, "position");

-- transportation_zones --------------------------------------------------------
alter table public.transportation_zones
  drop constraint if exists transportation_zones_name_key;
create unique index if not exists transportation_zones_firm_name_key
  on public.transportation_zones (firm_id, name);

-- enum_options ----------------------------------------------------------------
-- enum_options_entity_field_value_idx is a bare unique index.
drop index if exists public.enum_options_entity_field_value_idx;
create unique index if not exists enum_options_firm_entity_field_value_idx
  on public.enum_options (firm_id, entity, field, value);

-- email_mailboxes -------------------------------------------------------------
alter table public.email_mailboxes
  drop constraint if exists email_mailboxes_email_address_key;
create unique index if not exists email_mailboxes_firm_email_address_key
  on public.email_mailboxes (firm_id, email_address);

-- chat_channels ---------------------------------------------------------------
alter table public.chat_channels drop constraint if exists chat_channels_matter_id_key;
create unique index if not exists chat_channels_firm_matter_id_key
  on public.chat_channels (firm_id, matter_id);

-- Original: CREATE UNIQUE INDEX idx_chat_channels_dm_pair ON public.chat_channels
--   (LEAST(member_ids[1], member_ids[2]), GREATEST(member_ids[1], member_ids[2]))
--   WHERE ((type = 'dm') AND (array_length(member_ids, 1) = 2))
drop index if exists public.idx_chat_channels_dm_pair;
create unique index if not exists idx_chat_channels_firm_dm_pair
  on public.chat_channels (firm_id, least(member_ids[1], member_ids[2]), greatest(member_ids[1], member_ids[2]))
  where type = 'dm' and array_length(member_ids, 1) = 2;

-- firm_profiles ---------------------------------------------------------------
-- Original: partial unique index firm_profiles_one_default ON (is_default) WHERE is_default.
drop index if exists public.firm_profiles_one_default;
create unique index if not exists firm_profiles_one_default_per_firm
  on public.firm_profiles (firm_id) where is_default;

-- invoice_number_counters: PK (billing_month) -> PK (firm_id, billing_month) ---
alter table public.invoice_number_counters add column if not exists firm_id uuid;
update public.invoice_number_counters
   set firm_id = '00000000-0000-4000-8000-000000000001'
 where firm_id is null;
alter table public.invoice_number_counters alter column firm_id set not null;
-- TRANSITIONAL default; dropped in the service-role discipline phase.
alter table public.invoice_number_counters
  alter column firm_id set default '00000000-0000-4000-8000-000000000001';
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_number_counters_firm_id_fkey'
      and conrelid = 'public.invoice_number_counters'::regclass
  ) then
    alter table public.invoice_number_counters
      add constraint invoice_number_counters_firm_id_fkey
      foreign key (firm_id) references public.firms(id);
  end if;
end $$;
do $$ begin
  if exists (
    select 1 from pg_constraint c
    where c.conname = 'invoice_number_counters_pkey'
      and c.conrelid = 'public.invoice_number_counters'::regclass
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (billing_month)'
  ) then
    alter table public.invoice_number_counters drop constraint invoice_number_counters_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoice_number_counters'::regclass and contype = 'p'
  ) then
    alter table public.invoice_number_counters
      add constraint invoice_number_counters_pkey primary key (firm_id, billing_month);
  end if;
end $$;

-- client_code_counters: PK (scope) -> PK (firm_id); the scope column is retired --
alter table public.client_code_counters add column if not exists firm_id uuid;
update public.client_code_counters
   set firm_id = '00000000-0000-4000-8000-000000000001'
 where firm_id is null;
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'client_code_counters'
      and column_name = 'scope'
  ) then
    delete from public.client_code_counters where scope = 'global';
    alter table public.client_code_counters drop constraint if exists client_code_counters_pkey;
    alter table public.client_code_counters drop column scope;
  end if;
end $$;
alter table public.client_code_counters alter column firm_id set not null;
-- TRANSITIONAL default; dropped in the service-role discipline phase.
alter table public.client_code_counters
  alter column firm_id set default '00000000-0000-4000-8000-000000000001';
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_code_counters_firm_id_fkey'
      and conrelid = 'public.client_code_counters'::regclass
  ) then
    alter table public.client_code_counters
      add constraint client_code_counters_firm_id_fkey
      foreign key (firm_id) references public.firms(id);
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_code_counters'::regclass and contype = 'p'
  ) then
    alter table public.client_code_counters
      add constraint client_code_counters_pkey primary key (firm_id);
  end if;
end $$;
