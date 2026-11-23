-- provisioning_patterns(): the regex literals scripts/provision-firm.ts validates
-- operator input against, read out of the live CHECK constraints rather than
-- restated in TypeScript.
--
-- A firm slug that fails firms_slug_check, or an invoice prefix that fails
-- firm_invoice_settings_prefix_shape, should be rejected with a readable message
-- naming the shape — not surface as a 23514 halfway through provisioning, after
-- the auth user has been created. Reading the pattern from pg_constraint means
-- the script cannot drift from the database when a constraint is widened.
--
-- SECURITY DEFINER so the catalog read reflects the full schema; execution is
-- service_role-only, matching tenant_tables() (20260823_tenant_registry_rpc.sql).

create or replace function public.provisioning_patterns()
returns table (name text, pattern text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.name,
    (regexp_match(pg_get_constraintdef(con.oid), '~ ''(.+)''::text'))[1] as pattern
  from (values
    ('firm_slug', 'firms_slug_check'),
    ('invoice_prefix', 'firm_invoice_settings_prefix_shape')
  ) as v(name, conname)
  join pg_catalog.pg_constraint con on con.conname = v.conname
  join pg_catalog.pg_class c on c.oid = con.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public';
$$;

revoke execute on function public.provisioning_patterns() from public;
revoke execute on function public.provisioning_patterns() from anon;
revoke execute on function public.provisioning_patterns() from authenticated;
grant execute on function public.provisioning_patterns() to service_role;
