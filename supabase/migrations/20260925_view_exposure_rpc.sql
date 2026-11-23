-- view_exposure(): every public view, and what it hands to PostgREST.
--
-- The catalog-wide half of 20260925_views_security_invoker.sql. That migration
-- fixed the two views that existed; this is what keeps the next one honest.
-- A view created in `public` gets Supabase's default grants — ALL to anon and
-- authenticated — and, without security_invoker, runs as its owner, which
-- skips RLS on everything it reads. Nothing about that shape shows up in a
-- per-table probe, and the security advisor reports it only as a lint. So
-- scripts/rls-probe.ts reads this and fails on any view that:
--   - is not security_invoker,
--   - grants anon anything,
--   - grants authenticated a write (a simple view is auto-updatable, so a
--     write grant is a second door into the base table),
--   - carries no firm_id (the service-role facade cannot scope it).
-- scripts/generate-tenant-registry.ts reads it too, to build TENANT_VIEWS.
--
-- SECURITY DEFINER so the answer reflects the catalog, not the caller's
-- privileges; execution is service_role-only, like tenant_tables().

create or replace function public.view_exposure()
returns table (
  view_name text,
  security_invoker boolean,
  anon_privileges text[],
  authenticated_write_privileges text[],
  has_firm_id boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.relname::text,
    coalesce(
      (select o.option_value::boolean
         from pg_catalog.pg_options_to_table(c.reloptions) o
        where o.option_name = 'security_invoker'),
      false),
    array(
      select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where pg_catalog.has_table_privilege('anon', c.oid, p)),
    array(
      select p from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
      where pg_catalog.has_table_privilege('authenticated', c.oid, p)),
    exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = c.oid and a.attname = 'firm_id' and not a.attisdropped)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
  order by 1;
$$;

revoke execute on function public.view_exposure() from public;
revoke execute on function public.view_exposure() from anon;
revoke execute on function public.view_exposure() from authenticated;
grant execute on function public.view_exposure() to service_role;
