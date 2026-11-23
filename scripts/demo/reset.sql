-- ── The public demo's nightly reset ──────────────────────────────────
--
-- NOT a migration, and it must never become one. Migrations reach every
-- firm's instance through fleet:migrate; this deletes and rewrites a whole
-- firm's rows, which is the last thing that should exist on a client's
-- database, guarded or not. It is installed by hand on the one project that
-- serves the demo (fleet/instances.json → demo.lumilex.co), from the SQL
-- editor or the Supabase MCP, and re-running it is safe.
--
-- What it installs, all in the `demo_snapshot` schema, which PostgREST does
-- not expose and no API role can use:
--
--   take(firm)     copies every public tenant table's rows for the demo firm
--                  into demo_snapshot.<table>, and records the storage objects
--                  under the firm's prefix as the golden manifest.
--   restore(firm)  deletes the firm's rows and puts the snapshot back, every
--                  date and timestamp moved forward by the days since the
--                  snapshot so the demo is always "today", events that land
--                  on a weekend nudged to the nearest weekday.
--   invoke(action) calls the demo-reset edge function (supabase/functions/
--                  demo-reset), which runs take/restore and reconciles
--                  storage — the part SQL cannot do: it keeps a golden copy of
--                  every seeded object in the private `demo-golden` bucket,
--                  puts back any a visitor deleted, and removes any a visitor
--                  uploaded.
--
-- The schedule: pg_cron at 19:00 UTC, which is 03:00 in Manila — the time the
-- in-app banner promises.
--
-- Both functions refuse a firm that is not marked settings.demo.enabled. Rows
-- are restored with session_replication_role = replica, so no trigger fires:
-- a restored matter does not open a second chat channel, a restored file does
-- not queue an analysis, and FK order does not matter.
--
-- `ai_usage_hourly` is left alone: it is the ledger the AI ceiling counts
-- against, and a reset must not refill a visitor's allowance.

create schema if not exists demo_snapshot;
revoke all on schema demo_snapshot from public, anon, authenticated, service_role;

create table if not exists demo_snapshot.meta (
  firm_id uuid primary key,
  taken_at timestamptz not null,
  taken_day date not null,
  rows bigint not null
);

create table if not exists demo_snapshot.objects (
  bucket_id text not null,
  name text not null,
  primary key (bucket_id, name)
);

create or replace function demo_snapshot.assert_demo(p_firm_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.firms
     where id = p_firm_id and coalesce((settings->'demo'->>'enabled')::boolean, false)
  ) then
    raise exception 'firm % is not marked settings.demo.enabled', p_firm_id;
  end if;
end;
$$;

create or replace function demo_snapshot.take(p_firm_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  t text;
  n bigint;
  total bigint := 0;
  tables int := 0;
begin
  perform demo_snapshot.assert_demo(p_firm_id);

  for t in
    select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'demo_snapshot' and c.relkind = 'r' and c.relname not in ('meta', 'objects')
  loop
    execute format('drop table demo_snapshot.%I', t);
  end loop;

  for t in select * from public.tenant_tables() loop
    continue when t = 'ai_usage_hourly';
    execute format(
      'create table demo_snapshot.%I as select * from public.%I where firm_id = %L',
      t, t, p_firm_id
    );
    get diagnostics n = row_count;
    total := total + n;
    tables := tables + 1;
  end loop;

  delete from demo_snapshot.objects;
  insert into demo_snapshot.objects (bucket_id, name)
  select bucket_id, name from storage.objects
   where name like p_firm_id::text || '/%' and bucket_id <> 'demo-golden';

  insert into demo_snapshot.meta (firm_id, taken_at, taken_day, rows)
  values (p_firm_id, now(), (now() at time zone 'Asia/Manila')::date, total)
  on conflict (firm_id) do update
    set taken_at = excluded.taken_at, taken_day = excluded.taken_day, rows = excluded.rows;

  return format('%s rows across %s tables, %s objects', total, tables,
    (select count(*) from demo_snapshot.objects));
end;
$$;

-- Days to move a Manila weekend day onto a weekday: Saturday back to Friday,
-- Sunday on to Monday.
create or replace function demo_snapshot.off_weekend(p_day date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case extract(isodow from p_day) when 6 then -1 when 7 then 1 else 0 end;
$$;

create or replace function demo_snapshot.restore(p_firm_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_meta demo_snapshot.meta%rowtype;
  v_shift integer;
  t text;
  cols text;
  sel text;
  n bigint;
  total bigint := 0;
begin
  perform demo_snapshot.assert_demo(p_firm_id);
  select * into v_meta from demo_snapshot.meta where firm_id = p_firm_id;
  if not found then
    raise exception 'no snapshot for firm % — run demo_snapshot.take first', p_firm_id;
  end if;
  v_shift := (now() at time zone 'Asia/Manila')::date - v_meta.taken_day;

  set local session_replication_role = replica;

  for t in select * from public.tenant_tables() loop
    continue when t = 'ai_usage_hourly';
    execute format('delete from public.%I where firm_id = %L', t, p_firm_id);
  end loop;

  for t in
    select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'demo_snapshot' and c.relkind = 'r' and c.relname not in ('meta', 'objects')
  loop
    -- A table dropped since the snapshot is skipped; a column added since
    -- takes its default; one dropped is left out. Retake the snapshot after
    -- any migration that touches seeded tables.
    continue when to_regclass(format('public.%I', t)) is null;

    select
      string_agg(format('%I', a.attname), ', ' order by a.attnum),
      string_agg(
        case
          when a.atttypid = 'date'::regtype then format('%I + %s', a.attname, v_shift)
          when a.atttypid in ('timestamptz'::regtype, 'timestamp'::regtype)
            then format('%I + make_interval(days => %s)', a.attname, v_shift)
          else format('%I', a.attname)
        end,
        ', ' order by a.attnum)
    into cols, sel
    from pg_attribute a
    where a.attrelid = format('public.%I', t)::regclass
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and exists (
        select 1 from pg_attribute s
         where s.attrelid = format('demo_snapshot.%I', t)::regclass
           and s.attname = a.attname and not s.attisdropped
      );

    execute format(
      'insert into public.%I (%s) overriding system value select %s from demo_snapshot.%I',
      t, cols, sel, t
    );
    get diagnostics n = row_count;
    total := total + n;
  end loop;

  -- Events on a weekend after the shift move to the nearest weekday.
  update public.hearings
     set "date" = "date" + make_interval(days => demo_snapshot.off_weekend(("date" at time zone 'Asia/Manila')::date))
   where firm_id = p_firm_id
     and demo_snapshot.off_weekend(("date" at time zone 'Asia/Manila')::date) <> 0;
  update public.meetings
     set date_start = date_start + make_interval(days => demo_snapshot.off_weekend((date_start at time zone 'Asia/Manila')::date)),
         date_end = date_end + make_interval(days => demo_snapshot.off_weekend((date_start at time zone 'Asia/Manila')::date))
   where firm_id = p_firm_id
     and demo_snapshot.off_weekend((date_start at time zone 'Asia/Manila')::date) <> 0;
  update public.deliverables
     set external_due_date = external_due_date + demo_snapshot.off_weekend(external_due_date)
   where firm_id = p_firm_id and demo_snapshot.off_weekend(external_due_date) <> 0;
  update public.tasks
     set due_date = due_date + demo_snapshot.off_weekend(due_date)
   where firm_id = p_firm_id and demo_snapshot.off_weekend(due_date) <> 0;
  update public.liaison_tasks
     set scheduled_for = scheduled_for + demo_snapshot.off_weekend(scheduled_for)
   where firm_id = p_firm_id and demo_snapshot.off_weekend(scheduled_for) <> 0;
  update public.liaison_tasks
     set due_date = due_date + demo_snapshot.off_weekend(due_date)
   where firm_id = p_firm_id and demo_snapshot.off_weekend(due_date) <> 0;

  return format('%s rows restored, dates moved %s days', total, v_shift);
end;
$$;

-- The private bucket that holds a golden copy of every seeded object, keyed
-- `<bucket>/<object name>`. Private and with no policy, like every bucket
-- but avatars and issuances.
insert into storage.buckets (id, name, public)
values ('demo-golden', 'demo-golden', false)
on conflict (id) do nothing;

-- The shared secret between the cron job and the edge function. Generated
-- here, never printed; both sides read it from the Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'demo_reset_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'demo_reset_secret',
      'Authenticates pg_cron to the demo-reset edge function'
    );
  end if;
end;
$$;

create or replace function demo_snapshot.invoke(p_action text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_secret text;
begin
  if p_action not in ('snapshot', 'reset') then
    raise exception 'unknown action %', p_action;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'demo_reset_secret';
  return net.http_post(
    url := 'https://jmwcsldskeycpgqtbcyx.supabase.co/functions/v1/demo-reset',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-demo-reset', v_secret),
    body := jsonb_build_object('action', p_action),
    timeout_milliseconds := 300000
  );
end;
$$;

revoke all on all functions in schema demo_snapshot from public, anon, authenticated, service_role;
revoke all on all tables in schema demo_snapshot from public, anon, authenticated, service_role;

select cron.schedule('demo-reset', '0 19 * * *', $$select demo_snapshot.invoke('reset')$$);
