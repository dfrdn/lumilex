-- The two public views ran with their owner's rights, and were writable by anon.
--
-- `filings` and `v_deliverable_version_lookup` were created without
-- `security_invoker`, so they executed as their owner, `postgres` — which holds
-- BYPASSRLS. Every policy on `deliverables` / `deliverable_files` was skipped,
-- and both views carried Supabase's default grants: ALL to anon and
-- authenticated. So with the public anon key:
--   GET    /rest/v1/filings        listed every firm's external deliverables;
--   GET    /rest/v1/v_deliverable_version_lookup  every firm's file names;
--   PATCH / DELETE /rest/v1/filings  wrote through — `filings` is a simple
--                                    single-table view, so Postgres makes it
--                                    auto-updatable — to any firm's
--                                    `deliverables` rows, as the owner.
--
-- Fix, three parts:
--   1. security_invoker = on: the caller's RLS on the base tables applies, so a
--      view can never show more than the tables behind it would.
--   2. Grants trimmed to SELECT for authenticated and service_role, nothing for
--      anon. Nothing in the app writes through either view (writes go to
--      `deliverables` directly), and a writable view is a second door to a
--      table whose policies were written for the first.
--   3. `firm_id` appended to both, so the service-role facade can scope them
--      (lib/tenancy/service-db.ts → TENANT_VIEWS). With no firm column a
--      service-role read of a view was unscoped by construction, and
--      getFilingById / the chat entity search returned other firms' rows.
--
-- CREATE OR REPLACE VIEW may only append columns, so both keep their existing
-- column list and order with `firm_id` last. The version lookup also requires
-- the file and its deliverable to share a firm: deliverable_files.deliverable_id
-- carries no foreign key, and a mismatched pair must not surface under either.
--
-- Idempotent: CREATE OR REPLACE, and the grants are reset rather than added.

create or replace view public.filings
  with (security_invoker = on)
as
select
  notion_id,
  notion_url,
  name,
  external_due_date as date,
  matter_id,
  matter_name,
  status,
  currently_with_ids as attendee_ids,
  null::text as related_deliverable_id,
  firm_id
from public.deliverables
where type = 'External'
  and external_due_date is not null;

create or replace view public.v_deliverable_version_lookup
  with (security_invoker = on)
as
select
  df.id as deliverable_file_id,
  df.deliverable_id,
  df.version,
  df.file_name,
  d.name as deliverable_name,
  d.matter_id,
  d.matter_name,
  d.type as deliverable_type,
  d.firm_id
from public.deliverable_files df
join public.deliverables d
  on d.notion_id = df.deliverable_id
 and d.firm_id = df.firm_id;

-- Belt and braces for a re-run against a view someone recreated by hand.
alter view public.filings set (security_invoker = on);
alter view public.v_deliverable_version_lookup set (security_invoker = on);

revoke all on public.filings, public.v_deliverable_version_lookup
  from public, anon, authenticated, service_role;
grant select on public.filings, public.v_deliverable_version_lookup
  to authenticated, service_role;
