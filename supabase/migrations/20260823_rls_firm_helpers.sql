-- Multitenancy RLS phase, part 1: firm-aware helper functions.
--
-- current_firm_id() grows a portal branch (client_users -> clients.firm_id) so
-- portal personas resolve a firm too; has_matter_access() and
-- can_access_email() become firm-bound so every policy built on them is
-- firm-scoped even before the column conjuncts land in the sweep migration.
-- Current definitions fetched from the dev project via pg_get_functiondef on
-- 2026-08-23; role lists and SECURITY/search_path settings preserved exactly.

-- Staff branch first (ord 1) so a hypothetical staff+portal account resolves
-- to its team firm deterministically.
create or replace function public.current_firm_id()
returns uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select firm_id from (
    select 1 as ord, t.firm_id
      from public.team t
     where t.auth_user_id = auth.uid() and t.active
    union all
    select 2 as ord, c.firm_id
      from public.client_users cu
      join public.clients c on c.notion_id = cu.client_id
     where cu.auth_user_id = auth.uid() and cu.active
  ) s
  order by ord
  limit 1
$$;

revoke execute on function public.current_firm_id() from public, anon;
grant execute on function public.current_firm_id() to authenticated, service_role;

create or replace function public.current_client_id()
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select client_id from public.client_users
   where auth_user_id = auth.uid() and active
   limit 1
$$;

revoke execute on function public.current_client_id() from public, anon;
grant execute on function public.current_client_id() to authenticated, service_role;

-- Same semantics as before (member of the matter OR privileged role), but the
-- role fall-through no longer reaches across firms: the matter row itself must
-- belong to the caller's firm.
create or replace function public.has_matter_access(p_matter_id text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.matters m
    where m.notion_id = p_matter_id
      and m.firm_id = public.current_firm_id()
      and (
        public.current_person_id() = any (m.team_person_ids)
        or public."current_role"() in
          ('partner','admin','super_user','finance','chief_liaison_officer','liaison_officer')
      )
  )
$$;

-- Owner/shared-mailbox and matter-link branches preserved; each branch now
-- also requires the email row (and its mailbox) to be in the caller's firm.
create or replace function public.can_access_email(p_email_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    public.current_person_id() is not null
    and (
      exists (
        select 1
        from public.emails e
        join public.email_mailboxes mb on mb.id = e.mailbox_id
        where e.id = p_email_id
          and e.firm_id = public.current_firm_id()
          and mb.firm_id = public.current_firm_id()
          and (
            mb.mailbox_type = 'shared'
            or mb.owner_person_id = public.current_person_id()
          )
      )
      or exists (
        select 1
        from public.email_matter_links l
        join public.emails e on e.id = l.email_id
        where l.email_id = p_email_id
          and e.firm_id = public.current_firm_id()
          and public.has_matter_access(l.matter_id)
      )
    )
$$;

-- Every authenticated principal may read exactly its own firm row.
drop policy if exists firms_self_select on public.firms;
create policy firms_self_select on public.firms
  for select to authenticated
  using (id = public.current_firm_id());
