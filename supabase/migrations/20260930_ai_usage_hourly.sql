-- ── A per-firm ceiling on model calls ────────────────────────────────
--
-- `firms.settings.aiLimits` ({ perHour, perDay }) caps how many model clients
-- lib/ai/gate.ts will build for a firm. Null — every real firm today — means
-- no ceiling and no row is ever written here. The public demo is the firm
-- that needs one: anyone can sign in to it, and every AI surface bills the
-- platform's own key.
--
-- One row per firm per hour. `perDay` is counted over the Manila calendar day,
-- which is when the demo's allowance visibly "resets" for a visitor.
--
-- Deny-by-default RLS, like the other ledgers (`agent_runs`, `audit_log`): the
-- only reader and writer is consume_ai_call() below, run by service_role.

create table if not exists public.ai_usage_hourly (
  firm_id uuid not null references public.firms(id) on delete cascade,
  hour timestamptz not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (firm_id, hour)
);

alter table public.ai_usage_hourly enable row level security;
revoke all on table public.ai_usage_hourly from anon, authenticated;

-- Spend one call if the firm is under both ceilings; true when it did.
--
-- Read-then-increment rather than increment-then-check, so a refusal leaves
-- the count where it was and the ledger records calls that were actually
-- allowed. Two concurrent calls can both pass the read and overshoot by one;
-- a ceiling that is a cost control rather than a quota can take that.
create or replace function public.consume_ai_call(
  p_firm_id uuid,
  p_per_hour integer,
  p_per_day integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hour timestamptz := date_trunc('hour', now());
  v_day_start timestamptz :=
    date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
  v_hour_calls integer;
  v_day_calls integer;
begin
  select coalesce(sum(calls), 0) into v_day_calls
    from public.ai_usage_hourly
   where firm_id = p_firm_id and hour >= v_day_start;

  select coalesce(max(calls), 0) into v_hour_calls
    from public.ai_usage_hourly
   where firm_id = p_firm_id and hour = v_hour;

  if v_day_calls >= p_per_day or v_hour_calls >= p_per_hour then
    return false;
  end if;

  insert into public.ai_usage_hourly (firm_id, hour, calls)
  values (p_firm_id, v_hour, 1)
  on conflict (firm_id, hour)
  do update set calls = public.ai_usage_hourly.calls + 1;

  return true;
end;
$$;

revoke execute on function public.consume_ai_call(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_call(uuid, integer, integer) to service_role;
