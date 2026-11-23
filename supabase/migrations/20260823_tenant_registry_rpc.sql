-- tenant_tables(): the introspection source for lib/tenancy/tables.generated.ts.
-- Returns every public BASE TABLE that carries a firm_id column. SECURITY DEFINER
-- so the result reflects the full catalog rather than the caller's privileges;
-- execution is service_role-only — the registry generator is the sole consumer.

create or replace function public.tenant_tables()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.table_name::text
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name = c.table_name
  where c.table_schema = 'public'
    and c.column_name = 'firm_id'
    and t.table_type = 'BASE TABLE'
  order by 1;
$$;

revoke execute on function public.tenant_tables() from public;
revoke execute on function public.tenant_tables() from anon;
revoke execute on function public.tenant_tables() from authenticated;
grant execute on function public.tenant_tables() to service_role;
