-- Who asked to open the public demo (lib/demo/access.ts).
--
-- A GLOBAL table: no firm_id, because a request belongs to no tenant — it is
-- the platform's own record of who wanted a look. It reaches every instance
-- through the fleet like any migration and stays empty everywhere but the
-- test project, where the demo deployment writes it.
--
-- Service-role only: RLS on with no policies, and no API role holds a grant.
-- The demo's sign-in route (app/api/auth/demo) inserts a row when a visitor
-- submits the form and reads one back by id to honour the access cookie.
-- Nothing else touches it.

create table if not exists public.demo_access_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254),
  position text not null check (char_length(position) between 1 and 120),
  -- The role they first chose: partner, lawyer, finance, admin or liaison.
  persona text not null,
  -- Where the form was submitted from: lumilex.co/demo or the demo itself.
  source text
);

create index if not exists demo_access_requests_created_at_idx
  on public.demo_access_requests (created_at desc);

alter table public.demo_access_requests enable row level security;

revoke all on public.demo_access_requests from public, anon, authenticated;
