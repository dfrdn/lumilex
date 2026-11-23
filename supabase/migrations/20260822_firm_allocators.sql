-- Multitenancy phase 2, wave 3: firm-scoped allocator functions.
--
-- current_firm_id() here is a minimal PLACEHOLDER (team.auth_user_id -> firm_id);
-- it is superseded by the full implementation in the RLS phase.
--
-- Column names verified on the dev project 2026-08-22:
--   invoices.billing_month exists (text 'YYYY-MM').
--   client_code_counters uses last_code (not last_seq).
--   firm_invoice_settings.invoice_prefix: check constraint ^[A-Z0-9]{2,8}$,
--   so interpolating it into the regex below cannot inject metacharacters.

create or replace function public.current_firm_id()
returns uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select firm_id from public.team where auth_user_id = auth.uid() and active limit 1
$$;

revoke execute on function public.current_firm_id() from public, anon;
grant execute on function public.current_firm_id() to authenticated, service_role;

create or replace function public.allocate_invoice_number(p_firm_id uuid, p_month text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_seq int;
  v_max int;
  v_re text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and public.current_firm_id() is distinct from p_firm_id then
    raise exception 'allocate_invoice_number: caller not authorized for firm'
      using errcode = '42501';
  end if;

  select invoice_prefix into strict v_prefix
    from public.firm_invoice_settings
   where firm_id = p_firm_id;

  v_re := '^' || v_prefix || '-\d{4}-\d{2}-';

  select coalesce(max((regexp_replace(invoice_number, v_re, ''))::int), 0)
    into v_max
    from public.invoices
   where firm_id = p_firm_id
     and billing_month = p_month
     and invoice_number ~ (v_re || '\d+$');

  insert into public.invoice_number_counters as c (firm_id, billing_month, last_seq)
  values (p_firm_id, p_month, v_max + 1)
  on conflict (firm_id, billing_month)
    do update set last_seq = greatest(c.last_seq, v_max) + 1
  returning c.last_seq into v_seq;

  return v_prefix || '-' || p_month || '-' || lpad(v_seq::text, 3, '0');
end $$;

create or replace function public.allocate_client_code(p_firm_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code int;
  v_max int;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and public.current_firm_id() is distinct from p_firm_id then
    raise exception 'allocate_client_code: caller not authorized for firm'
      using errcode = '42501';
  end if;

  select coalesce(max(client_code), 0) into v_max
    from public.clients
   where firm_id = p_firm_id;

  insert into public.client_code_counters as c (firm_id, last_code)
  values (p_firm_id, v_max + 1)
  on conflict (firm_id)
    do update set last_code = greatest(c.last_code, v_max) + 1
  returning c.last_code into v_code;

  return v_code;
end $$;

-- Retire the pre-multitenancy signatures.
drop function if exists public.allocate_invoice_number(text);
drop function if exists public.allocate_client_code();

-- Re-apply EXECUTE discipline to the new signatures.
revoke execute on function public.allocate_invoice_number(uuid, text) from public, anon;
grant execute on function public.allocate_invoice_number(uuid, text) to authenticated, service_role;
revoke execute on function public.allocate_client_code(uuid) from public, anon;
grant execute on function public.allocate_client_code(uuid) to authenticated, service_role;
