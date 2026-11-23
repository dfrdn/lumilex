-- ── Calendar feed tokens ────────────────────────────────────────────
-- One subscribable ICS feed per person, replacing the Graph push that wrote
-- Lumilex events into each staff member's Outlook calendar.
--
-- The token IS the credential. It rides in a URL that Outlook, Google and
-- Apple store on their own servers and replay unauthenticated, forever, until
-- it is rotated — so it is held to the rules a bearer secret deserves:
--
--   * Its own table, not a column on `team`. `team_authenticated_select` lets
--     every authenticated colleague read every column of every team row in the
--     firm; a token column there would hand one person's hearings, matters and
--     clients to the whole staff. RLS is row-level, so there is no way to
--     exempt one column.
--   * RLS enabled with NO policies — service-role only, like the other
--     deny-by-default tables. Nothing reads this through PostgREST.
--   * One row per person. Rotating replaces the token in place, which is what
--     makes rotation a revocation: the old URL resolves to nothing.

create table if not exists public.calendar_feed_tokens (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  person_id text not null,
  token text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_accessed_at timestamptz
);

-- Resolution is by token alone (the request carries no firm), so uniqueness
-- has to be global rather than per firm.
create unique index if not exists calendar_feed_tokens_token_key
  on public.calendar_feed_tokens (token);

create unique index if not exists calendar_feed_tokens_person_key
  on public.calendar_feed_tokens (firm_id, person_id);

alter table public.calendar_feed_tokens enable row level security;
